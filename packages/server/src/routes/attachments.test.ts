import type { Note, NoteCreate, SealedNote } from "@manifesto/shared";
import {
  attachmentIdOf,
  MAX_IMAGE_SOURCE_BYTES,
  NoteColor,
  NoteFont,
  SEALED_IMAGE_OVERHEAD,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { opened, sealedCreate } from "../storage/contracts/claimed.js";
import { defined } from "../test/defined.js";
import { heldKeyOf } from "../test/keyedTokens.js";
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
    call(who, "GET", `/api/attachments/${attachmentIdOf(defined(ref))}`);

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
    expect((await fetchAs(owner, defined(note.images[0]))).status).toBe(200);
    expect((await fetchAs(alice, defined(note.images[0]))).status).toBe(200);
    expect((await fetchAs(mallory, defined(note.images[0]))).status).toBe(404);
    // The owner trashing the note takes it away from the recipient.
    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: true });
    expect((await fetchAs(alice, defined(note.images[0]))).status).toBe(404);
  });

  it("stores an editor's image under the note's owner", async () => {
    const note = await create(owner, []);
    await share(note.id, alice);
    const res = await call(alice, "PUT", `/api/notes/${note.id}`, {
      images: [await uploadAs(alice, GIF)],
    });
    const [ref] = ((await res.json()) as { note: Note }).note.images;
    const meta = await rig.storage.attachments.meta(
      attachmentIdOf(defined(ref)),
    );
    expect(meta?.ownerId).toBe(owner.userId);
  });

  it("refuses a viewer's images, and images for a note it cannot see", async () => {
    const note = await create(owner, [PNG]);
    await share(note.id, alice, "view");
    const byViewer = await call(alice, "PUT", `/api/notes/${note.id}`, {
      images: [await uploadAs(alice, GIF)],
      pinned: true,
    });
    expect(byViewer.status).toBe(403);
    const byStranger = await call(mallory, "PUT", `/api/notes/${note.id}`, {
      images: [await uploadAs(mallory, GIF)],
    });
    expect(byStranger.status).toBe(404);
    const kept = await rig.storage.notes.getById(note.id, owner.userId);
    expect(kept && opened(kept).images).toEqual(note.images);
    expect(
      (await rig.storage.notes.getById(note.id, alice.userId))?.pinned,
    ).toBe(false);
  });

  it("copies an image an editor may read into their own note", async () => {
    const shared = await create(owner, [PNG]);
    await share(shared.id, alice);
    const mine = await create(alice, [defined(shared.images[0])]);
    expect(mine.images[0]).not.toBe(shared.images[0]);
    const meta = await rig.storage.attachments.meta(
      attachmentIdOf(defined(mine.images[0])),
    );
    expect(meta?.ownerId).toBe(alice.userId);
    // The same sealed bytes, so the key the note holds still opens them.
    const theirs = await rig.storage.attachments.get(
      attachmentIdOf(defined(shared.images[0])),
    );
    const copy = await rig.storage.attachments.get(
      attachmentIdOf(defined(mine.images[0])),
    );
    expect(copy && theirs && copy.data.equals(theirs.data)).toBe(true);
  });

  describe("claiming before a note names an image", () => {
    const claim = (who: Account, body: object) =>
      call(who, "POST", "/api/attachments/claim", body);
    const refsOf = async (res: Response) =>
      ((await res.json()) as { refs: string[] }).refs;

    it("hands back what the owner already holds as it is, and once however often", async () => {
      const mine = await uploadAs(owner, PNG);
      const res = await claim(owner, { refs: [mine, mine] });
      expect(await refsOf(res)).toEqual([mine, mine]);
      const note = await create(owner, []);
      expect(
        await refsOf(await claim(owner, { noteId: note.id, refs: [mine] })),
      ).toEqual([mine]);
    });

    it("stores an editor's image for the note's owner, the same one each time", async () => {
      const note = await create(owner, []);
      await share(note.id, alice);
      const hers = await uploadAs(alice, GIF);
      const [first] = await refsOf(
        await claim(alice, { noteId: note.id, refs: [hers] }),
      );
      expect(first).not.toBe(hers);
      const [again] = await refsOf(
        await claim(alice, { noteId: note.id, refs: [hers] }),
      );
      expect(again).toBe(first);
    });

    it("refuses a viewer, a stranger to the note, and what the caller cannot read", async () => {
      const note = await create(owner, [PNG]);
      await share(note.id, alice, "view");
      const hers = await uploadAs(alice, GIF);
      expect(
        (await claim(alice, { noteId: note.id, refs: [hers] })).status,
      ).toBe(403);
      expect((await claim(mallory, { noteId: note.id, refs: [] })).status).toBe(
        404,
      );
      expect((await claim(mallory, { refs: note.images })).status).toBe(422);
      expect((await claim(mallory, { refs: ["data:image/png"] })).status).toBe(
        422,
      );
    });

    it("leaves a note naming someone else's image to be refused when written", async () => {
      const theirs = await uploadAs(owner, PNG);
      // Around the claim, as a client that skipped it would.
      const res = await rig.rawRequest("/api/notes", {
        method: "POST",
        headers: authHeaders(mallory.token),
        body: JSON.stringify(sealedCreate({ ...baseNote, images: [theirs] })),
      });
      expect(res.status).toBe(422);
    });
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
    const id = attachmentIdOf(defined(note.images[0]));
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
      const ref = defined(stored).image as string;
      expect(stored?.favicon).toBe(ref);
      const meta = await rig.storage.attachments.meta(
        attachmentIdOf(defined(ref)),
      );
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
      const id = attachmentIdOf(defined(ref));
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
        linkPreviews: [preview(defined(theirs.images[0]))],
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
      expect((await fetchAs(alice, defined(secret.images[0]))).status).toBe(
        404,
      );
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

    it("stores and serves what it is sent, as bytes of no stated kind", async () => {
      const res = await upload(owner, PNG_BYTES, "image/jpeg");
      expect(res.status).toBe(201);
      const { ref } = (await res.json()) as { ref: string };
      // As the server answers, before the app opens the image.
      const served = await rig.rawRequest(
        `/api/attachments/${ref.slice("attachment:".length)}`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );
      expect(served.headers.get("Content-Type")).toBe(
        "application/octet-stream",
      );
      expect(served.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect((await served.arrayBuffer()).byteLength).toBe(
        PNG_BYTES.length + SEALED_IMAGE_OVERHEAD,
      );
    });

    it("starts the grace again when an image is uploaded again", async () => {
      const res = await upload(owner, PNG_BYTES, "image/png");
      const { ref } = (await res.json()) as { ref: string };
      const id = attachmentIdOf(defined(ref));
      const later = "2026-09-01T00:00:00.000Z";
      const much = "2027-01-01T00:00:00.000Z";
      // Never referred to, so the first sweep marks it.
      await rig.storage.attachments.sweep(NOW, "2000-01-01T00:00:00.000Z");
      // Attached again, to an editor that has not saved yet.
      await upload(owner, PNG_BYTES, "image/png");
      await rig.storage.attachments.sweep(later, NOW);
      expect(await rig.storage.attachments.sweep(much, later)).toBe(0);
      expect(await rig.storage.attachments.meta(id)).not.toBeNull();
    });

    it("lets a token that carries keys attach an image and read it back, sealed at rest", async () => {
      const minted = await rig.request("/api/tokens", {
        method: "POST",
        headers: authHeaders(owner.token),
        body: JSON.stringify({ name: "Script", password: "test-pass-12" }),
      });
      expect(minted.status).toBe(201);
      const script: Account = {
        token: ((await minted.json()) as { secret: string }).secret,
        userId: owner.userId,
      };
      const get = (who: Account, id: string, query = "") =>
        rig.rawRequest(`/api/attachments/${id}${query}`, {
          headers: authHeaders(who.token),
        });

      // The script sends the image itself.
      const sent = await upload(script, PNG_BYTES, "image/png");
      expect(sent.status).toBe(201);
      const { ref } = (await sent.json()) as { ref: string };
      const id = attachmentIdOf(ref);
      // What is stored is neither the image nor of any stated kind.
      const stored = await rig.storage.attachments.get(id);
      if (!stored) throw new Error("the upload was not stored");
      expect(stored.contentType).toBe("application/octet-stream");
      expect(stored.data.equals(PNG_BYTES)).toBe(false);
      expect(stored.data.includes(PNG_BYTES.subarray(0, 8))).toBe(false);
      expect(stored.wrappedKey).toMatch(/^e1\./);

      // Before any note names it, its uploader can still read it back.
      const early = await get(script, id);
      expect(early.headers.get("Content-Type")).toBe("image/png");
      expect(Buffer.from(await early.arrayBuffer()).equals(PNG_BYTES)).toBe(
        true,
      );

      // A note names it, and carries its key from then on.
      const made = await rig.request("/api/notes", {
        method: "POST",
        headers: authHeaders(script.token),
        body: JSON.stringify({ ...baseNote, title: "Receipt", images: [ref] }),
      });
      expect(made.status).toBe(201);
      const note = ((await made.json()) as { note: Note }).note;
      expect(note.images).toEqual([ref]);
      const read = await get(script, id, `?note=${note.id}`);
      expect(read.status).toBe(200);
      expect(read.headers.get("Content-Type")).toBe("image/png");
      expect(Buffer.from(await read.arrayBuffer()).equals(PNG_BYTES)).toBe(
        true,
      );
      // The key kept with the upload still opens it for its uploader,
      // whichever note is named.
      const other = await rig.request("/api/notes", {
        method: "POST",
        headers: authHeaders(script.token),
        body: JSON.stringify(baseNote),
      });
      const otherId = ((await other.json()) as { note: Note }).note.id;
      expect((await get(script, id, `?note=${otherId}`)).status).toBe(200);

      // The app is still sent the sealed bytes, and opens them itself.
      const sealed = await get(owner, id);
      expect(sealed.headers.get("Content-Type")).toBe(
        "application/octet-stream",
      );
      expect(Buffer.from(await sealed.arrayBuffer()).equals(stored.data)).toBe(
        true,
      );

      // Not an image, whatever it is called; and nothing at all.
      expect(
        (await upload(script, Buffer.from("<svg/>"), "image/png")).status,
      ).toBe(415);
      expect((await upload(script, new Uint8Array(), "image/png")).status).toBe(
        422,
      );
    });

    it("lets an editor's token add its own upload to a note shared with it", async () => {
      const mint = async (who: Account): Promise<Account> => {
        const minted = await rig.request("/api/tokens", {
          method: "POST",
          headers: authHeaders(who.token),
          body: JSON.stringify({ name: "Script", password: "test-pass-12" }),
        });
        return {
          token: ((await minted.json()) as { secret: string }).secret,
          userId: who.userId,
        };
      };
      // Written by a token, so it is sealed under a real key.
      const made = await call(await mint(owner), "POST", "/api/notes", {
        ...baseNote,
        title: "Trip",
      });
      const { id } = ((await made.json()) as { note: Note }).note;
      await call(owner, "POST", `/api/notes/${id}/shares`, {
        userId: alice.userId,
        role: "edit",
      });
      const sealed = (
        (await (
          await rig.rawRequest(`/api/notes/${id}`, {
            headers: authHeaders(owner.token),
          })
        ).json()) as { note: SealedNote }
      ).note;
      const accepted = await rig.rawRequest(`/api/invitations/${id}/accept`, {
        method: "POST",
        headers: authHeaders(alice.token),
        body: JSON.stringify(
          await heldKeyOf(sealed, owner.userId, alice.userId),
        ),
      });
      expect(accepted.status).toBe(200);

      const script = await mint(alice);
      const sent = await upload(script, PNG_BYTES, "image/png");
      const { ref } = (await sent.json()) as { ref: string };
      const written = await call(script, "PUT", `/api/notes/${id}`, {
        images: [ref],
      });
      expect(written.status).toBe(200);
      const { images } = ((await written.json()) as { note: Note }).note;
      // The note names the owner's copy, which the key of the upload opens.
      const copy = attachmentIdOf(defined(images[0]));
      expect(copy).not.toBe(attachmentIdOf(ref));
      expect((await rig.storage.attachments.meta(copy))?.ownerId).toBe(
        owner.userId,
      );
      const read = await rig.rawRequest(`/api/attachments/${copy}?note=${id}`, {
        headers: authHeaders(script.token),
      });
      expect(read.status).toBe(200);
      expect(Buffer.from(await read.arrayBuffer()).equals(PNG_BYTES)).toBe(
        true,
      );
    });

    it("asks a token which note an image is in, when the image is not its own upload", async () => {
      // Uploaded sealed by the app, so no key is kept with it.
      const res = await upload(owner, PNG_BYTES, "image/png");
      const id = attachmentIdOf(((await res.json()) as { ref: string }).ref);
      const minted = await rig.request("/api/tokens", {
        method: "POST",
        headers: authHeaders(owner.token),
        body: JSON.stringify({ name: "Script", password: "test-pass-12" }),
      });
      const secret = ((await minted.json()) as { secret: string }).secret;
      const get = (query: string) =>
        rig.rawRequest(`/api/attachments/${id}${query}`, {
          headers: authHeaders(secret),
        });
      expect((await get("")).status).toBe(400);
      expect((await get("?note=01NOSUCHNOTE")).status).toBe(404);
    });

    it("refuses an upload with no address, or with nothing in it", async () => {
      // Sent as it is: the server cannot tell an image from anything else
      // once it is sealed, so the address is what it asks for.
      const bare = (headers: Record<string, string>, body: Uint8Array) =>
        rig.rawRequest("/api/attachments", {
          method: "POST",
          headers: { Authorization: `Bearer ${owner.token}`, ...headers },
          body: body as BodyInit,
        });
      expect((await bare({}, PNG_BYTES)).status).toBe(422);
      expect(
        (await bare({ "X-Attachment-Address": "not an address" }, PNG_BYTES))
          .status,
      ).toBe(422);
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
