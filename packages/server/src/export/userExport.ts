import {
  attachmentIdOf,
  isAttachmentRef,
  type Note,
  type NoteVersion,
} from "@manifesto/shared";
import type { Context } from "hono";
import type { StorageDriver } from "../storage/types.js";
import { buildZip } from "./zip.js";

/**
 * Everything an account owns, as one zip, for a person leaving, moving to
 * another server, or asking what is held about them:
 *
 * - `notes.json`: every note, the trash and archive included, in the client's
 *   import format with images inlined as `data:` URLs, so importing it
 *   anywhere (open mode too) restores the notes as they were;
 * - `notes/<title>.md`: each note not in the trash as Markdown, with
 *   frontmatter (tags, pinned, archived, dates) that the client's
 *   Markdown-folder import reads back, for any other tool to open;
 * - `versions.json`: the server's version history of those notes;
 * - `account.json`: the account's own details.
 *
 * Notes shared with the account are someone else's and stay out.
 */
export async function exportAccount(
  storage: StorageDriver,
  userId: string,
): Promise<Buffer | null> {
  const user = await storage.users.findById(userId);
  if (!user) return null;

  const notes: Note[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.notes.listByUser(userId, {
      limit: 200,
      ...(cursor && { cursor }),
    });
    for (const listed of page.notes) {
      if ((listed.sharing?.role ?? "owner") !== "owner") continue;
      const full = await storage.notes.getById(listed.id, userId);
      if (full) notes.push(await inlineImages(storage, full));
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  const versions: NoteVersion[] = [];
  for (const note of notes)
    versions.push(...(await storage.versions.list(note.id)));

  const plain = notes.map(
    ({ sharing: _s, imageCount: _c, readonly: _r, source: _src, ...note }) =>
      note,
  );
  const names = new Set<string>();
  const markdown = notes
    .filter((note) => !note.trashed)
    .map((note) => ({
      name: `notes/${uniqueName(fileNameOf(note), names)}.md`,
      data: Buffer.from(noteToMarkdownFile(note)),
    }));

  return buildZip([
    { name: "notes.json", data: Buffer.from(JSON.stringify(plain, null, 2)) },
    ...markdown,
    {
      name: "versions.json",
      data: Buffer.from(JSON.stringify(versions, null, 2)),
    },
    {
      name: "account.json",
      data: Buffer.from(
        JSON.stringify(
          {
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            signIn: user.provider === "local" ? "password" : "single sign-on",
            isAdmin: user.isAdmin,
            createdAt: user.createdAt,
          },
          null,
          2,
        ),
      ),
    },
  ]);
}

async function inlineImages(storage: StorageDriver, note: Note): Promise<Note> {
  const images: string[] = [];
  for (const image of note.images) {
    if (!isAttachmentRef(image)) {
      images.push(image);
      continue;
    }
    const stored = await storage.attachments.get(attachmentIdOf(image));
    if (stored) {
      images.push(
        `data:${stored.contentType};base64,${stored.data.toString("base64")}`,
      );
    }
  }
  return { ...note, images };
}

function fileNameOf(note: Note): string {
  const cleaned = note.title
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();
  return cleaned || "Untitled";
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
  taken.add(name.toLowerCase());
  return name;
}

/** YAML only needs quoting where a plain scalar would be misread. */
function yamlString(value: string): string {
  return /^[\w .,'()&+-]*$/.test(value) &&
    value.trim() === value &&
    value !== ""
    ? value
    : JSON.stringify(value);
}

export function noteToMarkdownFile(note: Note): string {
  const front = [
    "---",
    `title: ${yamlString(note.title)}`,
    ...(note.tags.length > 0
      ? ["tags:", ...note.tags.map((tag) => `  - ${yamlString(tag)}`)]
      : []),
    ...(note.pinned ? ["pinned: true"] : []),
    ...(note.archived ? ["archived: true"] : []),
    `created: ${note.createdAt}`,
    `updated: ${note.updatedAt}`,
    "---",
    "",
  ];
  const body = note.content.endsWith("\n") ? note.content : `${note.content}\n`;
  return `${front.join("\n")}${body}`;
}

/** The zip as a download named after the account and the day. */
export function sendExport(c: Context, zip: Buffer, username?: string) {
  const slug = (username ?? "account").replace(/[^\w.-]+/g, "_");
  const date = new Date().toISOString().slice(0, 10);
  return c.body(new Uint8Array(zip), 200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${slug}-notes-${date}.zip"`,
    "Content-Length": String(zip.length),
    "Cache-Control": "no-store",
  });
}
