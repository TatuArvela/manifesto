import {
  type ApiTokenScope,
  MAX_NOTES_PAGE_SIZE,
  type Note,
  NoteColor,
  NoteFont,
  type NoteResponse,
  type NotesResponse,
} from "@manifesto/shared";
import { z } from "zod";
import { noteColorSchema } from "../validation/schemas.js";

/**
 * The tools `/api/mcp` offers an AI assistant. Each one is REST calls and
 * nothing else: `call` is handed a `RestCall` that runs the real route
 * in-process with the caller's token, so authentication, validation, sharing
 * roles, rate limits, the `If-Match` check, broadcasts and webhooks all apply
 * as they would to the web client, and no rule is written twice. A tool that
 * needs more than one route (a new note's place on the board, the tag list)
 * composes them; it never reaches storage.
 *
 * Deleting is left out on purpose. `trash_note` is as far as an assistant
 * goes, so whatever it did can be undone from the trash.
 */

export interface RestAnswer {
  status: number;
  body: unknown;
}

export type RestCall = (
  method: "GET" | "POST" | "PUT",
  path: string,
  options?: { body?: unknown; ifMatch?: string | undefined },
) => Promise<RestAnswer>;

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** What the token needs for the tool to be offered at all. The REST
   * routes the tool calls check their own scopes as well. */
  scope: ApiTokenScope;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  call(args: unknown, rest: RestCall): Promise<ToolResult>;
}

/** A route that did not answer 2xx, carried out of a tool to its caller. */
class RestFailure extends Error {
  constructor(readonly answer: RestAnswer) {
    super(`REST ${answer.status}`);
  }
}

function expectOk<T>(answer: RestAnswer): T {
  if (answer.status < 200 || answer.status > 299) throw new RestFailure(answer);
  return answer.body as T;
}

function ok(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** What a route's refusal means, in words an assistant can act on. */
function describeFailure({ status, body }: RestAnswer): string {
  const said =
    typeof body === "object" && body !== null && "error" in body
      ? String((body as { error: unknown }).error)
      : "";
  if (status === 412) {
    const current = (body as { note?: Note } | null)?.note;
    return (
      "The note changed since you read it. Read it again with get_note and " +
      "make the change on the current text" +
      (current ? ` (it is now at updatedAt ${current.updatedAt}).` : ".")
    );
  }
  if (status === 404) return "No such note, or it is not shared with you.";
  if (status === 429) return "Too many requests; wait a minute and try again.";
  return `The server refused (${status})${said ? `: ${said}` : ""}.`;
}

/** A note as an assistant needs it: no layout, fonts or attachment refs. */
function brief(note: Note) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    color: note.color,
    tags: note.tags,
    pinned: note.pinned,
    archived: note.archived,
    trashed: note.trashed,
    reminder: note.reminder,
    imageCount: note.imageCount ?? note.images.length,
    role: note.sharing?.role ?? "owner",
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** Every note the account has, archived and trashed ones included. */
async function allNotes(rest: RestCall): Promise<Note[]> {
  const notes: Note[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ limit: String(MAX_NOTES_PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const page: NotesResponse = expectOk(
      await rest("GET", `/api/notes?${query}`),
    );
    notes.push(...page.notes);
    cursor = page.nextCursor;
  } while (cursor);
  return notes;
}

const notePath = (id: string) => `/api/notes/${encodeURIComponent(id)}`;

const idField = z.string().min(1).max(64).describe("The note's id");
const updatedAtField = z
  .string()
  .max(40)
  .describe(
    "The note's updatedAt from when you read it. If the note has changed since, the change is refused rather than written over someone else's.",
  );
const pageFields = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .exactOptional()
    .describe("Notes per page, 20 when left out"),
  cursor: z
    .string()
    .max(200)
    .exactOptional()
    .describe("The nextCursor of the previous page"),
};
const tagsField = z
  .array(z.string().trim().min(1).max(64))
  .max(50)
  .describe("The note's tags, replacing any it had");

function defineTool<S extends z.ZodType>(tool: {
  name: string;
  title: string;
  description: string;
  input: S;
  scope: ApiTokenScope;
  destructive?: boolean;
  idempotent?: boolean;
  run(args: z.output<S>, rest: RestCall): Promise<ToolResult>;
}): McpTool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.input, {
      io: "input",
      target: "draft-2020-12",
    }),
    scope: tool.scope,
    annotations: {
      readOnlyHint: tool.scope === "notes:read",
      destructiveHint: tool.destructive ?? false,
      idempotentHint: tool.idempotent ?? tool.scope === "notes:read",
      openWorldHint: false,
    },
    async call(args, rest) {
      const parsed = tool.input.safeParse(args ?? {});
      if (!parsed.success) {
        return toolError(
          `Invalid arguments:\n${z.prettifyError(parsed.error)}`,
        );
      }
      try {
        return await tool.run(parsed.data, rest);
      } catch (err) {
        if (err instanceof RestFailure)
          return toolError(describeFailure(err.answer));
        throw err;
      }
    },
  };
}

const VIEWS = {
  active: (n: Note) => !n.archived && !n.trashed,
  archived: (n: Note) => n.archived && !n.trashed,
  trashed: (n: Note) => n.trashed,
  all: () => true,
};

/** Where a new note goes: ahead of every other, as the web client puts it. */
const POSITION_STEP = 1000;

export const MCP_TOOLS: readonly McpTool[] = [
  defineTool({
    name: "search_notes",
    title: "Search notes",
    description:
      "Find notes whose title or content contains the query, newest first. Includes archived notes; trashed ones are marked trashed.",
    input: z.object({
      query: z.string().trim().min(1).max(500).describe("Text to look for"),
      ...pageFields,
    }),
    scope: "notes:read",
    async run({ query, limit, cursor }, rest) {
      const params = new URLSearchParams({
        q: query,
        limit: String(limit ?? 20),
      });
      if (cursor) params.set("cursor", cursor);
      const page: NotesResponse = expectOk(
        await rest("GET", `/api/search?${params}`),
      );
      return ok({ notes: page.notes.map(brief), nextCursor: page.nextCursor });
    },
  }),

  defineTool({
    name: "list_notes",
    title: "List notes",
    description:
      "One page of the user's notes, most recently changed first. A page can hold fewer than limit once filtered by view or tag; keep following nextCursor until it is null.",
    input: z.object({
      view: z
        .enum(["active", "archived", "trashed", "all"])
        .exactOptional()
        .describe(
          "Which notes: active (the default), archived, trashed or all",
        ),
      tag: z
        .string()
        .max(64)
        .exactOptional()
        .describe("Only notes with this tag"),
      ...pageFields,
    }),
    scope: "notes:read",
    async run({ view, tag, limit, cursor }, rest) {
      const params = new URLSearchParams({ limit: String(limit ?? 20) });
      if (cursor) params.set("cursor", cursor);
      const page: NotesResponse = expectOk(
        await rest("GET", `/api/notes?${params}`),
      );
      const inView = VIEWS[view ?? "active"];
      const notes = page.notes.filter(
        (n) => inView(n) && (tag === undefined || n.tags.includes(tag)),
      );
      return ok({ notes: notes.map(brief), nextCursor: page.nextCursor });
    },
  }),

  defineTool({
    name: "get_note",
    title: "Read a note",
    description: "One note in full, by id.",
    input: z.object({ id: idField }),
    scope: "notes:read",
    async run({ id }, rest) {
      const { note }: NoteResponse = expectOk(await rest("GET", notePath(id)));
      return ok({ note: brief(note) });
    },
  }),

  defineTool({
    name: "list_tags",
    title: "List tags",
    description:
      "Every tag on the user's notes outside the trash, with how many notes carry it, most used first.",
    input: z.object({}),
    scope: "notes:read",
    async run(_args, rest) {
      const counts = new Map<string, number>();
      for (const note of await allNotes(rest)) {
        if (note.trashed) continue;
        for (const tag of note.tags)
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      const tags = [...counts]
        .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
        .map(([tag, count]) => ({ tag, count }));
      return ok({ tags });
    },
  }),

  defineTool({
    name: "create_note",
    title: "Create a note",
    description:
      "Add a note at the top of the board. Content is Markdown; `- [ ] item` lines make a checklist.",
    input: z.object({
      title: z.string().max(500).exactOptional(),
      content: z.string().max(100_000).describe("The note's text, in Markdown"),
      color: noteColorSchema.exactOptional().describe("The card's colour"),
      tags: tagsField.exactOptional(),
      pinned: z.boolean().exactOptional(),
    }),
    scope: "notes:write",
    idempotent: false,
    async run({ title, content, color, tags, pinned }, rest) {
      const lowest = (await allNotes(rest)).reduce(
        (min, n) => Math.min(min, n.position),
        POSITION_STEP,
      );
      const { note }: NoteResponse = expectOk(
        await rest("POST", "/api/notes", {
          body: {
            title: title ?? "",
            content,
            color: color ?? NoteColor.Default,
            font: NoteFont.Default,
            pinned: pinned ?? false,
            archived: false,
            trashed: false,
            position: lowest - POSITION_STEP,
            tags: tags ?? [],
            images: [],
            linkPreviews: [],
            reminder: null,
          },
        }),
      );
      return ok({ note: brief(note) });
    },
  }),

  defineTool({
    name: "update_note",
    title: "Change a note",
    description:
      "Change some of a note's fields; what is left out stays as it is. Pass the updatedAt you read so a change made meanwhile by someone else is not written over. Set trashed to false to restore a note from the trash.",
    input: z
      .object({
        id: idField,
        updatedAt: updatedAtField.exactOptional(),
        title: z.string().max(500).exactOptional(),
        content: z
          .string()
          .max(100_000)
          .exactOptional()
          .describe("The whole new text, in Markdown"),
        color: noteColorSchema.exactOptional(),
        tags: tagsField.exactOptional(),
        pinned: z.boolean().exactOptional(),
        archived: z.boolean().exactOptional(),
        trashed: z
          .literal(false)
          .exactOptional()
          .describe("false restores the note from the trash"),
      })
      .refine(
        ({ id: _id, updatedAt: _at, ...fields }) =>
          Object.values(fields).some((value) => value !== undefined),
        { message: "Give at least one field to change" },
      ),
    scope: "notes:write",
    destructive: true,
    idempotent: true,
    async run({ id, updatedAt, ...fields }, rest) {
      const { note }: NoteResponse = expectOk(
        await rest("PUT", notePath(id), { body: fields, ifMatch: updatedAt }),
      );
      return ok({ note: brief(note) });
    },
  }),

  defineTool({
    name: "trash_note",
    title: "Move a note to the trash",
    description:
      "Move a note to the trash, where it stays for 30 days and can be restored with update_note. For a note someone shared with you, only your copy goes.",
    input: z.object({ id: idField, updatedAt: updatedAtField.exactOptional() }),
    scope: "notes:write",
    destructive: true,
    idempotent: true,
    async run({ id, updatedAt }, rest) {
      const { note }: NoteResponse = expectOk(
        await rest("PUT", notePath(id), {
          body: { trashed: true },
          ifMatch: updatedAt,
        }),
      );
      return ok({ note: brief(note) });
    },
  }),
];
