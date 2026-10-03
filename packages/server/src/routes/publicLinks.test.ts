import type {
  Note,
  NoteCreate,
  PublicLink,
  PublicNoteResponse,
} from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nowIso } from "../lib/time.js";
import {
  authHeaders,
  bootTestApp,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(4)}=`;
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

const baseNote: NoteCreate = {
  title: "Recipe",
  content: "Flour and water",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: ["private"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

type Account = { token: string; userId: string };

describe("public links", () => {
  let rig: TestRig;
  let owner: Account;

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
  });

  afterEach(async () => {
    await rig.close();
    vi.useRealTimers();
  });

  function call(
    who: Account | null,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return rig.request(path, {
      method,
      headers: {
        ...(who
          ? authHeaders(who.token)
          : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? null : JSON.stringify(body),
    });
  }

  async function upload(image: string): Promise<string> {
    const res = await rig.request("/api/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": image.slice(5, image.indexOf(";")),
      },
      body: Buffer.from(image.slice(image.indexOf(",") + 1), "base64"),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { ref: string }).ref;
  }

  async function createNote(fields: Partial<NoteCreate> = {}): Promise<Note> {
    const res = await call(owner, "POST", "/api/notes", {
      ...baseNote,
      ...fields,
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { note: Note }).note;
  }

  async function publish(
    noteId: string,
    body: Record<string, unknown> = { mode: "live" },
  ): Promise<PublicLink> {
    const res = await call(owner, "POST", `/api/notes/${noteId}/links`, body);
    expect(res.status).toBe(201);
    return ((await res.json()) as { link: PublicLink }).link;
  }

  async function visit(token: string): Promise<Response> {
    return call(null, "GET", `/api/public/${token}`);
  }

  async function shown(token: string): Promise<PublicNoteResponse> {
    const res = await visit(token);
    expect(res.status).toBe(200);
    return (await res.json()) as PublicNoteResponse;
  }

  it("shows the note to anyone holding the link, and counts the view", async () => {
    const note = await createNote();
    const link = await publish(note.id);

    const res = await visit(link.token);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    const body = (await res.json()) as PublicNoteResponse;
    expect(body.note).toMatchObject({
      title: "Recipe",
      content: "Flour and water",
      color: NoteColor.Yellow,
    });
    // Nothing about the owner's filing of it.
    expect(body.note).not.toHaveProperty("tags");
    expect(body.access).toBeNull();

    const list = await call(owner, "GET", `/api/notes/${note.id}/links`);
    const { links } = (await list.json()) as { links: PublicLink[] };
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ viewCount: 1, mode: "live" });
    expect(links[0]?.lastViewedAt).not.toBeNull();
  });

  it("follows the note when live, and keeps it as it was when a snapshot", async () => {
    const note = await createNote();
    const live = await publish(note.id);
    const snapshot = await publish(note.id, { mode: "snapshot" });
    await call(owner, "PUT", `/api/notes/${note.id}`, { content: "Edited" });

    expect((await shown(live.token)).note.content).toBe("Edited");
    expect((await shown(snapshot.token)).note.content).toBe("Flour and water");
  });

  it("stops at once when revoked", async () => {
    const note = await createNote();
    const link = await publish(note.id);
    const res = await call(
      owner,
      "DELETE",
      `/api/notes/${note.id}/links/${link.token}`,
    );
    expect(res.status).toBe(204);
    expect((await visit(link.token)).status).toBe(404);
  });

  it("stops when it expires, and when its views are used up", async () => {
    const note = await createNote();
    const once = await publish(note.id, { mode: "live", maxViews: 1 });
    expect((await visit(once.token)).status).toBe(200);
    expect((await visit(once.token)).status).toBe(404);

    const soon = await publish(note.id, { mode: "live", expiresInDays: 1 });
    expect((await visit(soon.token)).status).toBe(200);
    vi.useFakeTimers({
      toFake: ["Date"],
      now: Date.parse(nowIso()) + 2 * 24 * 60 * 60 * 1000,
    });
    expect((await visit(soon.token)).status).toBe(404);
  });

  it("asks for the password before showing or counting anything", async () => {
    const note = await createNote();
    const link = await publish(note.id, { mode: "live", password: "sesame" });

    const locked = await visit(link.token);
    expect(locked.status).toBe(401);
    expect(await locked.json()).toEqual({ passwordRequired: true });

    const wrong = await call(null, "POST", `/api/public/${link.token}/unlock`, {
      password: "wrong",
    });
    expect(wrong.status).toBe(403);

    const right = await call(null, "POST", `/api/public/${link.token}/unlock`, {
      password: "sesame",
    });
    expect(right.status).toBe(200);
    const body = (await right.json()) as PublicNoteResponse;
    expect(body.note.title).toBe("Recipe");
    expect(body.access).toEqual(expect.any(String));

    const list = await call(owner, "GET", `/api/notes/${note.id}/links`);
    const { links } = (await list.json()) as { links: PublicLink[] };
    expect(links[0]).toMatchObject({ viewCount: 1, hasPassword: true });
  });

  it("serves only the pictures the note shows, and with the password's proof", async () => {
    const shownRef = await upload(PNG);
    const otherRef = await upload(GIF);
    const note = await createNote({ images: [shownRef] });
    const id = shownRef.slice("attachment:".length);
    const other = otherRef.slice("attachment:".length);

    const open = await publish(note.id);
    const picture = await call(
      null,
      "GET",
      `/api/public/${open.token}/attachments/${id}`,
    );
    expect(picture.status).toBe(200);
    expect(picture.headers.get("Content-Type")).toBe("image/png");
    expect(
      (
        await call(
          null,
          "GET",
          `/api/public/${open.token}/attachments/${other}`,
        )
      ).status,
    ).toBe(404);

    const guarded = await publish(note.id, { mode: "live", password: "pw" });
    const path = `/api/public/${guarded.token}/attachments/${id}`;
    expect((await call(null, "GET", path)).status).toBe(404);
    const unlocked = await call(
      null,
      "POST",
      `/api/public/${guarded.token}/unlock`,
      { password: "pw" },
    );
    const { access } = (await unlocked.json()) as PublicNoteResponse;
    expect(
      (await call(null, "GET", path, undefined, { "X-Link-Access": "nope" }))
        .status,
    ).toBe(404);
    expect(
      (
        await call(null, "GET", path, undefined, {
          "X-Link-Access": access as string,
        })
      ).status,
    ).toBe(200);
  });

  it("goes offline while the note is in the trash, and comes back with it", async () => {
    const note = await createNote();
    const link = await publish(note.id, { mode: "snapshot" });
    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: true });
    expect((await visit(link.token)).status).toBe(404);
    await call(owner, "PUT", `/api/notes/${note.id}`, { trashed: false });
    expect((await visit(link.token)).status).toBe(200);
  });

  it("dies with its note", async () => {
    const note = await createNote();
    const link = await publish(note.id);
    await call(owner, "DELETE", `/api/notes/${note.id}`);
    expect((await visit(link.token)).status).toBe(404);
  });

  it("is the owner's alone to make", async () => {
    const note = await createNote();
    const alice = await registerTestUser(rig, "alice");
    const stranger = await call(alice, "POST", `/api/notes/${note.id}/links`, {
      mode: "live",
    });
    expect(stranger.status).toBe(404);

    await call(owner, "POST", `/api/notes/${note.id}/shares`, {
      userId: alice.userId,
      role: "edit",
    });
    await call(alice, "POST", `/api/invitations/${note.id}/accept`);
    const editor = await call(alice, "POST", `/api/notes/${note.id}/links`, {
      mode: "live",
    });
    expect(editor.status).toBe(403);
    expect(
      (await call(alice, "GET", `/api/notes/${note.id}/links`)).status,
    ).toBe(403);
  });

  it("refuses a note in the trash", async () => {
    const note = await createNote({ trashed: true });
    const res = await call(owner, "POST", `/api/notes/${note.id}/links`, {
      mode: "live",
    });
    expect(res.status).toBe(409);
  });

  describe("a link that can edit", () => {
    const edit = (
      token: string,
      body: unknown,
      ifMatch: string | null,
      headers: Record<string, string> = {},
    ) =>
      call(null, "PUT", `/api/public/${token}`, body, {
        ...(ifMatch !== null && { "If-Match": ifMatch }),
        ...headers,
      });

    const ownerNote = async (id: string) =>
      (
        (await (await call(owner, "GET", `/api/notes/${id}`)).json()) as {
          note: Note;
        }
      ).note;

    it("lets its holder change the title and the text, and nothing else", async () => {
      const note = await createNote();
      const link = await publish(note.id, { mode: "live", canEdit: true });
      expect(link.canEdit).toBe(true);
      const seen = await shown(link.token);
      expect(seen.canEdit).toBe(true);

      const res = await edit(
        link.token,
        { content: "Flour, water and salt", tags: ["hacked"], pinned: true },
        seen.note.updatedAt,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as PublicNoteResponse;
      expect(body.note.content).toBe("Flour, water and salt");
      expect(body.note.updatedAt).not.toBe(seen.note.updatedAt);

      const mine = await ownerNote(note.id);
      expect(mine).toMatchObject({
        title: "Recipe",
        content: "Flour, water and salt",
        tags: ["private"],
        pinned: false,
      });
    });

    it("is refused by a link that only reads, as if there were no such link", async () => {
      const note = await createNote();
      const link = await publish(note.id);
      const seen = await shown(link.token);
      expect(seen.canEdit).toBeUndefined();
      const res = await edit(link.token, { content: "x" }, seen.note.updatedAt);
      expect(res.status).toBe(404);
      expect((await ownerNote(note.id)).content).toBe("Flour and water");
    });

    it("cannot be a snapshot, or limited by views", async () => {
      const note = await createNote();
      for (const body of [
        { mode: "snapshot", canEdit: true },
        { mode: "live", canEdit: true, maxViews: 3 },
      ]) {
        const res = await call(
          owner,
          "POST",
          `/api/notes/${note.id}/links`,
          body,
        );
        expect(res.status, JSON.stringify(body)).toBe(422);
      }
    });

    it("does not write over an edit it was not shown", async () => {
      const note = await createNote();
      const link = await publish(note.id, { mode: "live", canEdit: true });
      const seen = await shown(link.token);

      // The owner changes the note after the page was opened.
      await new Promise((r) => setTimeout(r, 5));
      await call(owner, "PUT", `/api/notes/${note.id}`, {
        content: "The owner's text",
      });

      const stale = await edit(
        link.token,
        { content: "The visitor's text" },
        seen.note.updatedAt,
      );
      expect(stale.status).toBe(412);
      const current = (await stale.json()) as PublicNoteResponse;
      expect(current.note.content).toBe("The owner's text");
      expect((await ownerNote(note.id)).content).toBe("The owner's text");

      // On top of what it was just shown, it lands.
      const retried = await edit(
        link.token,
        { content: "Both texts" },
        current.note.updatedAt,
      );
      expect(retried.status).toBe(200);
      expect((await ownerNote(note.id)).content).toBe("Both texts");
    });

    it("has to say which copy it edits, and to change something", async () => {
      const note = await createNote();
      const link = await publish(note.id, { mode: "live", canEdit: true });
      const seen = await shown(link.token);
      expect((await edit(link.token, { content: "x" }, null)).status).toBe(428);
      expect((await edit(link.token, {}, seen.note.updatedAt)).status).toBe(
        422,
      );
      expect(
        (
          await edit(
            link.token,
            { content: "x".repeat(100_001) },
            seen.note.updatedAt,
          )
        ).status,
      ).toBe(422);
    });

    it("needs the password's proof on a link that has one", async () => {
      const note = await createNote();
      const link = await publish(note.id, {
        mode: "live",
        canEdit: true,
        password: "sesame",
      });
      const unlocked = (await (
        await call(null, "POST", `/api/public/${link.token}/unlock`, {
          password: "sesame",
        })
      ).json()) as PublicNoteResponse;
      expect(unlocked.canEdit).toBe(true);

      const without = await edit(
        link.token,
        { content: "x" },
        unlocked.note.updatedAt,
      );
      expect(without.status).toBe(404);
      const withProof = await edit(
        link.token,
        { content: "Let in" },
        unlocked.note.updatedAt,
        { "X-Link-Access": unlocked.access ?? "" },
      );
      expect(withProof.status).toBe(200);
    });

    it("stops when the link is revoked, expired, or its note is in the trash", async () => {
      const note = await createNote();
      const link = await publish(note.id, { mode: "live", canEdit: true });
      const seen = await shown(link.token);

      const current = await ownerNote(note.id);
      await rig.request(`/api/notes/${note.id}`, {
        method: "PUT",
        headers: { ...authHeaders(owner.token), "If-Match": current.updatedAt },
        body: JSON.stringify({ trashed: true }),
      });
      expect(
        (await edit(link.token, { content: "x" }, seen.note.updatedAt)).status,
      ).toBe(404);

      const other = await createNote();
      const second = await publish(other.id, { mode: "live", canEdit: true });
      const shownSecond = await shown(second.token);
      await call(
        owner,
        "DELETE",
        `/api/notes/${other.id}/links/${second.token}`,
      );
      expect(
        (await edit(second.token, { content: "x" }, shownSecond.note.updatedAt))
          .status,
      ).toBe(404);
      expect((await ownerNote(other.id)).content).toBe("Flour and water");
    });

    it("keeps the note as it was as a version, and tells the owner, once a sitting", async () => {
      const note = await createNote();
      const link = await publish(note.id, { mode: "live", canEdit: true });
      const seen = await shown(link.token);
      const events: string[] = [];
      rig.broadcaster.subscribe((userId, event) => {
        if (userId === owner.userId) events.push(event.type);
      });

      const first = (await (
        await edit(link.token, { content: "One" }, seen.note.updatedAt)
      ).json()) as PublicNoteResponse;
      await new Promise((r) => setTimeout(r, 5));
      await edit(link.token, { content: "Two" }, first.note.updatedAt);

      // The owner's open tabs hear each edit.
      expect(events.filter((type) => type === "note:updated")).toHaveLength(2);

      const versions = (await (
        await call(owner, "GET", `/api/notes/${note.id}/versions`)
      ).json()) as { versions: { content: string; via?: string }[] };
      expect(versions.versions).toHaveLength(1);
      expect(versions.versions[0]).toMatchObject({
        content: "Flour and water",
        via: "link",
      });

      await new Promise((r) => setTimeout(r, 20));
      const entries = await rig.storage.audit.list({
        limit: 20,
        action: "link.note_edited",
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: null,
        targetId: owner.userId,
        noteId: note.id,
      });
      expect(entries[0]?.detail.link).toBe(`${link.token.slice(0, 6)}...`);
      // And it is on the owner's own Activity page.
      const activity = (await (
        await call(owner, "GET", "/api/auth/me/activity")
      ).json()) as { entries: { action: string }[] };
      expect(
        activity.entries.some((e) => e.action === "link.note_edited"),
      ).toBe(true);
    });
  });

  it("writes the audit log", async () => {
    const note = await createNote();
    const link = await publish(note.id);
    await call(owner, "DELETE", `/api/notes/${note.id}/links/${link.token}`);
    await vi.waitFor(async () => {
      const entries = await rig.storage.audit.list({ limit: 10 });
      expect(entries.map((e) => e.action)).toEqual(
        expect.arrayContaining(["link.created", "link.revoked"]),
      );
    });
  });
});

describe("public links turned off", () => {
  it("answers every route with 404", async () => {
    const rig = await bootTestAppWith({ publicLinks: false });
    try {
      const owner = await registerTestUser(rig, "olivia");
      const created = await rig.request("/api/notes", {
        method: "POST",
        headers: authHeaders(owner.token),
        body: JSON.stringify(baseNote),
      });
      const { note } = (await created.json()) as { note: Note };
      const publish = await rig.request(`/api/notes/${note.id}/links`, {
        method: "POST",
        headers: authHeaders(owner.token),
        body: JSON.stringify({ mode: "live" }),
      });
      expect(publish.status).toBe(404);
      expect((await rig.request("/api/public/anything")).status).toBe(404);
      const capabilities = await rig.request("/api/capabilities");
      expect((await capabilities.json()).features.publicLinks).toBe(false);
    } finally {
      await rig.close();
    }
  });
});
