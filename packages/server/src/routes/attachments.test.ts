import type { Note, NoteCreate } from "@manifesto/shared";
import {
  attachmentIdOf,
  MAX_IMAGE_SOURCE_BYTES,
  NoteColor,
  NoteFont,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(4)}=`;
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const NOW = "2026-04-01T00:00:00.000Z";

const baseNote: NoteCreate = {
  title: "",
  content: "",
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
};

interface Account {
  token: string;
  userId: string;
}

describe("attachments", () => {
  let rig: TestRig;
  let owner: Account;
  let alice: Account;
  let mallory: Account;

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    alice = await registerTestUser(rig, "alice");
    mallory = await registerTestUser(rig, "mallory");
  });

  afterEach(async () => {
    await rig.close();
  });

  const call = (who: Account, method: string, path: string, body?: unknown) =>
    rig.request(path, {
      method,
      headers: authHeaders(who.token),
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

  /** Uploads a `data:` image as `who` and answers its reference. */
  async function uploadAs(who: Account, image: string): Promise<string> {
    if (!image.startsWith("data:")) return image;
    const res = await rig.request("/api/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${who.token}`,
        "Content-Type": image.slice(5, image.indexOf(";")),
      },
      body: Buffer.from(image.slice(image.indexOf(",") + 1), "base64"),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { ref: string }).ref;
  }

  async function create(who: Account, images: string[]): Promise<Note> {
    const refs = [];
    for (const image of images) refs.push(await uploadAs(who, image));
    const res = await call(who, "POST", "/api/notes", {
      ...baseNote,
      images: refs,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { note: Note }).note;
  }

  async function share(noteId: string, who: Account, role = "edit") {
    await call(owner, "POST", `/api/notes/${noteId}/shares`, {
      userId: who.userId,
      role,
    });
    await call(who, "POST", `/api/invitations/${noteId}/accept`);
  }

  const fetchAs = (who: Account, ref: string) =>
    call(who, "GET", `/api/attachments/${attachmentIdOf(ref)}`);

  it("stores the same image once per owner", async () => {
    const a = await create(owner, [PNG]);
    const b = await create(owner, [PNG, GIF]);
    expect(b.images[0]).toBe(a.images[0]);
    expect(b.images[1]).not.toBe(a.images[0]);
    // The same bytes sent again, as a stale tab would, change nothing.
    const res = await call(owner, "PUT", `/api/notes/${a.id}`, {
      images: [await uploadAs(owner, PNG)],
    });
    expect(((await res.json()) as { note: Note }).note.images).toEqual(
      a.images,
    );
  });

  it("serves a recipient and nobody else", async () => {
    const note = await create(owner, [PNG]);
    await share(note.id, alice, "view");
    expect((await fetchAs(owner, note.images[0])).status).toBe(200);
    expect((await fetchAs(alice, note.images[0])).status).toBe(200);
    expect((await fetchAs(mallory, note.images[0])).status).toBe(404);
    // The owner trashing the note takes it away from the recipient.
    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: true });
    expect((await fetchAs(alice, note.images[0])).status).toBe(404);
  });

  it("stores an editor's image under the note's owner", async () => {
    const note = await create(owner, []);
    await share(note.id, alice);
    const res = await call(alice, "PUT", `/api/notes/${note.id}`, {
      images: [await uploadAs(alice, GIF)],
    });
    const [ref] = ((await res.json()) as { note: Note }).note.images;
    const meta = await rig.storage.attachments.meta(attachmentIdOf(ref));
    expect(meta?.ownerId).toBe(owner.userId);
  });

  it("copies an image an editor may read into their own note", async () => {
    const shared = await create(owner, [PNG]);
    await share(shared.id, alice);
    const mine = await create(alice, [shared.images[0]]);
    expect(mine.images[0]).not.toBe(shared.images[0]);
    const meta = await rig.storage.attachments.meta(
      attachmentIdOf(mine.images[0]),
    );
    expect(meta?.ownerId).toBe(alice.userId);
  });

  it("refuses a reference the writer cannot read", async () => {
    const theirs = await create(owner, [PNG]);
    const res = await call(mallory, "POST", "/api/notes", {
      ...baseNote,
      images: [theirs.images[0]],
    });
    expect(res.status).toBe(422);
    const unknown = await call(mallory, "POST", "/api/notes", {
      ...baseNote,
      images: ["attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV"],
    });
    expect(unknown.status).toBe(422);
  });

  it("sweeps an image once nothing has referred to it for the grace period", async () => {
    const note = await create(owner, [PNG]);
    const id = attachmentIdOf(note.images[0]);
    await call(owner, "PUT", `/api/notes/${note.id}`, { images: [] });

    const later = "2026-09-01T00:00:00.000Z";
    const much = "2027-01-01T00:00:00.000Z";
    // First sweep marks it; it survives until the mark is old enough.
    expect(await rig.storage.attachments.sweep(later, NOW)).toBe(0);
    expect(await rig.storage.attachments.meta(id)).not.toBeNull();
    expect(await rig.storage.attachments.sweep(much, later)).toBe(0);
    expect(await rig.storage.attachments.sweep(much, much)).toBe(1);
    expect(await rig.storage.attachments.meta(id)).toBeNull();
  });

  it("clears the mark when a note refers to it again", async () => {
    const note = await create(owner, [PNG]);
    const ref = note.images[0];
    await call(owner, "PUT", `/api/notes/${note.id}`, { images: [] });
    await rig.storage.attachments.sweep(NOW, "2000-01-01T00:00:00.000Z");
    await call(owner, "PUT", `/api/notes/${note.id}`, { images: [ref] });
    await rig.storage.attachments.sweep(NOW, "2000-01-01T00:00:00.000Z");
    expect(await rig.storage.attachments.sweep(NOW, "2999-01-01")).toBe(0);
  });

  describe("link preview images", () => {
    const preview = (image: string, title = "Example") => ({
      url: "https://example.com/",
      title,
      image,
      favicon: image,
      domain: "example.com",
    });

    it("stores an editor's thumbnail under the owner, for every recipient", async () => {
      const note = await create(owner, []);
      await share(note.id, alice);
      await share(note.id, mallory, "view");
      const res = await call(alice, "PUT", `/api/notes/${note.id}`, {
        linkPreviews: [preview(await uploadAs(alice, GIF))],
      });
      expect(res.status).toBe(200);
      const [stored] = ((await res.json()) as { note: Note }).note.linkPreviews;
      const ref = stored.image as string;
      expect(stored.favicon).toBe(ref);
      const meta = await rig.storage.attachments.meta(attachmentIdOf(ref));
      expect(meta?.ownerId).toBe(owner.userId);
      expect((await fetchAs(mallory, ref)).status).toBe(200);
    });

    it("keeps a thumbnail through the sweep while a preview holds it", async () => {
      const ref = await uploadAs(owner, PNG);
      const res = await call(owner, "POST", "/api/notes", {
        ...baseNote,
        linkPreviews: [preview(ref)],
      });
      const note = ((await res.json()) as { note: Note }).note;
      const id = attachmentIdOf(ref);
      const much = "2027-01-01T00:00:00.000Z";
      await rig.storage.attachments.sweep(NOW, NOW);
      expect(await rig.storage.attachments.sweep(much, much)).toBe(0);
      await call(owner, "PUT", `/api/notes/${note.id}`, { linkPreviews: [] });
      await rig.storage.attachments.sweep(NOW, NOW);
      expect(await rig.storage.attachments.sweep(much, much)).toBe(1);
      expect(await rig.storage.attachments.meta(id)).toBeNull();
    });

    it("refuses a thumbnail the writer cannot read", async () => {
      const theirs = await create(owner, [PNG]);
      const res = await call(mallory, "POST", "/api/notes", {
        ...baseNote,
        linkPreviews: [preview(theirs.images[0])],
      });
      expect(res.status).toBe(422);
    });

    it("does not serve an attachment a shared preview only names in its title", async () => {
      const secret = await create(owner, [PNG]);
      const shared = await call(owner, "POST", "/api/notes", {
        ...baseNote,
        linkPreviews: [
          preview(await uploadAs(owner, GIF), `see ${secret.images[0]}`),
        ],
      });
      const note = ((await shared.json()) as { note: Note }).note;
      await share(note.id, alice, "view");
      expect((await fetchAs(alice, secret.images[0])).status).toBe(404);
    });
  });

  describe("uploads", () => {
    const PNG_BYTES = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const upload = (who: Account, body: Uint8Array, type: string) =>
      rig.request("/api/attachments", {
        method: "POST",
        headers: { Authorization: `Bearer ${who.token}`, "Content-Type": type },
        body: body as BodyInit,
      });

    it("stores a raw image and answers a reference a note can hold", async () => {
      const res = await upload(owner, PNG_BYTES, "image/png");
      expect(res.status).toBe(201);
      const { ref } = (await res.json()) as { ref: string };
      expect(ref).toMatch(/^attachment:/);
      const note = await create(owner, [ref]);
      expect(note.images).toEqual([ref]);
      const again = await upload(owner, PNG_BYTES, "image/png");
      expect(((await again.json()) as { ref: string }).ref).toBe(ref);
    });

    it("refuses a file that is not the image type it claims", async () => {
      expect((await upload(owner, PNG_BYTES, "image/jpeg")).status).toBe(415);
      const html = new TextEncoder().encode("<svg onload=alert(1)>");
      expect((await upload(owner, html, "image/png")).status).toBe(415);
      expect((await upload(owner, new Uint8Array(), "image/png")).status).toBe(
        422,
      );
    });

    it("takes an image of exactly the limit", async () => {
      const exact = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(MAX_IMAGE_SOURCE_BYTES - PNG_BYTES.length),
      ]);
      expect((await upload(owner, exact, "image/png")).status).toBe(201);
    });

    it("refuses an image over the limit", async () => {
      const big = Buffer.concat([
        PNG_BYTES,
        Buffer.alloc(MAX_IMAGE_SOURCE_BYTES),
      ]);
      expect((await upload(owner, big, "image/png")).status).toBe(413);
    });
  });
});
