import {
  MAX_NOTES_PAGE_SIZE,
  type Note,
  NoteColor,
  NoteFont,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { defined } from "#/test/defined.ts";
import { MCP_TOOLS, type RestAnswer, type RestCall } from "./tools.ts";

/**
 * Each tool against a stand-in for the routes. Thus, the test checks the own
 * part of the tool: the arguments that it takes, the requests that it makes,
 * and what it gives back to the assistant. `routes.test.ts` runs the tools
 * against the real app, and checks that the routes answer as this test thinks.
 */

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Title",
    content: "Body",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    ...overrides,
  };
}

interface Sent {
  method: string;
  path: string;
  body?: unknown;
  ifMatch?: string | undefined;
}

/** A `RestCall` that records each request and answers from `answer`. */
function routes(answer: (sent: Sent) => RestAnswer) {
  const sent: Sent[] = [];
  const rest: RestCall = async (method, path, options = {}) => {
    const request = { method, path, ...options };
    sent.push(request);
    return answer(request);
  };
  return { rest, sent };
}

const page = (notes: Note[], nextCursor: string | null = null) => ({
  status: 200,
  body: { notes, nextCursor },
});

function tool(name: string) {
  return defined(
    MCP_TOOLS.find((t) => t.name === name),
    name,
  );
}

function text(result: { content: { text: string }[] }): string {
  return result.content.map((part) => part.text).join("");
}

describe("the MCP tools", () => {
  it("say a tool that only reads is read-only and safe to repeat", () => {
    for (const t of MCP_TOOLS) {
      expect(t.annotations.readOnlyHint, t.name).toBe(t.scope === "notes:read");
      if (t.scope === "notes:read") {
        expect(t.annotations.idempotentHint, t.name).toBe(true);
      }
      expect(t.annotations.openWorldHint, t.name).toBe(false);
    }
  });

  it("offer no tool that deletes for good", () => {
    expect(MCP_TOOLS.map((t) => t.name)).not.toContain("delete_note");
  });

  it("refuse arguments off the schema without calling any route", async () => {
    const { rest, sent } = routes(() => page([]));
    const result = await tool("get_note").call({ id: ".." }, rest);
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("Invalid arguments");
    expect(sent).toEqual([]);
  });

  describe("a route's refusal, in words an assistant can act on", () => {
    async function refusedWith(answer: RestAnswer): Promise<string> {
      const { rest } = routes(() => answer);
      const result = await tool("get_note").call({ id: "n1" }, rest);
      expect(result.isError).toBe(true);
      return text(result);
    }

    it("tells it to read again when the note changed meanwhile", async () => {
      const said = await refusedWith({
        status: 412,
        body: { note: note({ updatedAt: "2026-05-01T00:00:00Z" }) },
      });
      expect(said).toContain("get_note");
      expect(said).toContain("2026-05-01T00:00:00Z");
    });

    it("names a missing note, a rate limit, and passes anything else on", async () => {
      expect(await refusedWith({ status: 404, body: null })).toContain(
        "No such note",
      );
      expect(await refusedWith({ status: 429, body: null })).toContain("wait");
      expect(
        await refusedWith({ status: 403, body: { error: "View only" } }),
      ).toBe("The server refused (403): View only.");
    });
  });

  it("hand back a note without its layout, fonts or attachment references", async () => {
    const { rest } = routes(() => ({
      status: 200,
      body: {
        note: note({
          images: ["attachment:a", "attachment:b"],
          sharing: { role: "edit" } as NonNullable<Note["sharing"]>,
        }),
      },
    }));
    const result = await tool("get_note").call({ id: "n1" }, rest);
    const brief = (
      result.structuredContent as { note: Record<string, unknown> }
    ).note;
    expect(brief).toMatchObject({ imageCount: 2, role: "edit" });
    expect(brief).not.toHaveProperty("images");
    expect(brief).not.toHaveProperty("font");
    expect(brief).not.toHaveProperty("position");
  });

  describe("list_notes", () => {
    it("keeps the view and the tag, nested tags included", async () => {
      const { rest, sent } = routes(() =>
        page(
          [
            note({ id: "a", tags: ["work"] }),
            note({ id: "b", tags: ["work/clients"] }),
            note({ id: "c", tags: ["workshop"] }),
            note({ id: "d", tags: ["work"], archived: true }),
            note({ id: "e", tags: ["work"], trashed: true }),
          ],
          "next",
        ),
      );
      const result = await tool("list_notes").call(
        { tag: "work", limit: 5, cursor: "c1" },
        rest,
      );
      const listed = result.structuredContent as {
        notes: { id: string }[];
        nextCursor: string | null;
      };
      expect(listed.notes.map((n) => n.id)).toEqual(["a", "b"]);
      expect(listed.nextCursor).toBe("next");
      expect(sent[0]?.path).toBe("/api/v1/notes?limit=5&cursor=c1");
    });

    it("lists the trash only when asked", async () => {
      const { rest } = routes(() =>
        page([note({ id: "a" }), note({ id: "t", trashed: true })]),
      );
      const result = await tool("list_notes").call({ view: "trashed" }, rest);
      expect(
        (result.structuredContent as { notes: { id: string }[] }).notes,
      ).toEqual([expect.objectContaining({ id: "t" })]);
    });
  });

  it("list_tags counts every page, leaves out the trash, and puts the most used first", async () => {
    const { rest, sent } = routes(({ path }) =>
      path.includes("cursor=")
        ? page([note({ tags: ["home", "b"] }), note({ tags: ["a"] })])
        : page(
            [note({ tags: ["home"] }), note({ tags: ["home"], trashed: true })],
            "p2",
          ),
    );
    const result = await tool("list_tags").call({}, rest);
    expect(result.structuredContent).toEqual({
      tags: [
        { tag: "home", count: 2 },
        { tag: "a", count: 1 },
        { tag: "b", count: 1 },
      ],
    });
    expect(sent.map((s) => s.path)).toEqual([
      `/api/v1/notes?limit=${MAX_NOTES_PAGE_SIZE}`,
      `/api/v1/notes?limit=${MAX_NOTES_PAGE_SIZE}&cursor=p2`,
    ]);
  });

  it("create_note puts the note ahead of every other, with defaults for what is left out", async () => {
    const { rest, sent } = routes(({ method }) =>
      method === "GET"
        ? page([note({ position: -500 }), note({ position: 3000 })])
        : { status: 201, body: { note: note() } },
    );
    await tool("create_note").call({ content: "- [ ] milk" }, rest);
    const created = sent.find((s) => s.method === "POST");
    expect(created?.path).toBe("/api/v1/notes");
    expect(created?.body).toMatchObject({
      title: "",
      content: "- [ ] milk",
      color: NoteColor.Default,
      pinned: false,
      tags: [],
      position: -1500,
    });
  });

  describe("update_note and trash_note", () => {
    it("send the updatedAt that was read as If-Match", async () => {
      const { rest, sent } = routes(() => ({
        status: 200,
        body: { note: note() },
      }));
      await tool("update_note").call(
        { id: "n1", updatedAt: "2026-04-01T00:00:00Z", title: "New" },
        rest,
      );
      await tool("trash_note").call(
        { id: "n1", updatedAt: "2026-04-01T00:00:00Z" },
        rest,
      );
      expect(sent).toEqual([
        {
          method: "PUT",
          path: "/api/v1/notes/n1",
          body: { title: "New" },
          ifMatch: "2026-04-01T00:00:00Z",
        },
        {
          method: "PUT",
          path: "/api/v1/notes/n1",
          body: { trashed: true },
          ifMatch: "2026-04-01T00:00:00Z",
        },
      ]);
    });

    it("refuse an update with nothing to change, and one that trashes", async () => {
      const { rest, sent } = routes(() => page([]));
      expect((await tool("update_note").call({ id: "n1" }, rest)).isError).toBe(
        true,
      );
      expect(
        (await tool("update_note").call({ id: "n1", trashed: true }, rest))
          .isError,
      ).toBe(true);
      expect(sent).toEqual([]);
    });
  });

  it("let an error that is not a route's refusal through", async () => {
    const rest: RestCall = async () => {
      throw new Error("the app fell over");
    };
    await expect(tool("get_note").call({ id: "n1" }, rest)).rejects.toThrow(
      "the app fell over",
    );
  });
});
