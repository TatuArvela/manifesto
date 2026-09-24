import {
  attachmentIdOf,
  exportArchiveFiles,
  isAttachmentRef,
  mapPreviewImages,
  type Note,
  type NoteVersion,
} from "@manifesto/shared";
import type { Context } from "hono";
import type { StorageDriver } from "../storage/types.js";
import { buildZip } from "./zip.js";

/**
 * Everything an account owns, as one zip, for a person leaving, moving to
 * another server, or asking what is held about them. The notes, their
 * Markdown copies and their history are laid out as `exportArchiveFiles`
 * says, the same as an open-mode export, with images (preview images too)
 * inlined so importing it anywhere restores the notes as they were; beside
 * them, `account.json` holds the account's own details.
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
  return buildZip([
    ...exportArchiveFiles(plain, versions).map(({ name, text }) => ({
      name,
      data: Buffer.from(text),
    })),
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
    const inlined = await inline(storage, image);
    if (inlined) images.push(inlined);
  }
  const linkPreviews = await mapPreviewImages(note.linkPreviews, (image) =>
    inline(storage, image),
  );
  return { ...note, images, linkPreviews };
}

/** An attachment reference as a `data:` URL; anything else as it is.
 * Undefined for an attachment that is gone. */
async function inline(
  storage: StorageDriver,
  image: string,
): Promise<string | undefined> {
  if (!isAttachmentRef(image)) return image;
  const stored = await storage.attachments.get(attachmentIdOf(image));
  return stored
    ? `data:${stored.contentType};base64,${stored.data.toString("base64")}`
    : undefined;
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
