import { inflateRawSync } from "node:zlib";
import type { Note } from "@manifesto/shared";
import { NoteColor, NoteFont, noteToMarkdownFile } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

/** Reads the files back out of a zip by its local headers. */
function unzip(zip: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let p = 0;
  while (zip.readUInt32LE(p) === 0x04034b50) {
    const size = zip.readUInt32LE(p + 18);
    const nameLength = zip.readUInt16LE(p + 26);
    const extra = zip.readUInt16LE(p + 28);
    const name = zip.subarray(p + 30, p + 30 + nameLength).toString("utf8");
    const start = p + 30 + nameLength + extra;
    files.set(
      name,
      inflateRawSync(zip.subarray(start, start + size)).toString("utf8"),
    );
    p = start + size;
  }
  return files;
}

const PNG = `data:image/png;base64,${"iVBORw0KGgo".repeat(4)}`;

const note = (overrides: Partial<Note>) => ({
  title: "",
  content: "",
  color: NoteColor.Default,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  position: 0,
  tags: [],
  images: [],
  linkPreviews: [],
  reminder: null,
  ...overrides,
});

describe("account export", () => {
  let rig: TestRig;
  let alice: { token: string; userId: string };

  beforeEach(async () => {
    rig = await bootTestApp();
    alice = await registerTestUser(rig, "alice");
  });

  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 20));
    await rig.close();
  });

  const upload = async (token: string) => {
    const res = await rig.request("/api/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: Buffer.from(PNG.slice(PNG.indexOf(",") + 1), "base64"),
    });
    return ((await res.json()) as { ref: string }).ref;
  };

  const create = (token: string, body: object) =>
    rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(note(body)),
    });

  it("zips every owned note as JSON with its images, and as Markdown", async () => {
    await create(alice.token, {
      title: "Trip: Lapland",
      content: "Pack skis",
      tags: ["travel"],
      pinned: true,
      images: [await upload(alice.token)],
    });
    await create(alice.token, { title: "Old", content: "gone", trashed: true });
    const bob = await registerTestUser(rig, "bob");
    await create(bob.token, { title: "Bob's", content: "not alice's" });

    const res = await rig.request("/api/export", {
      headers: authHeaders(alice.token),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="alice-notes-\d{4}-\d{2}-\d{2}\.zip"$/,
    );
    const files = unzip(Buffer.from(await res.arrayBuffer()));
    const notes = JSON.parse(files.get("notes.json") ?? "[]") as Note[];
    expect(notes.map((n) => n.title).sort()).toEqual(["Old", "Trip: Lapland"]);
    expect(notes.find((n) => n.title === "Trip: Lapland")?.images[0]).toMatch(
      /^data:image\/png;base64,/,
    );
    expect([...files.keys()].filter((f) => f.startsWith("notes/"))).toEqual([
      "notes/Trip Lapland.md",
    ]);
    expect(files.get("notes/Trip Lapland.md")).toContain("  - travel");
    expect(JSON.parse(files.get("account.json") ?? "{}").username).toBe(
      "alice",
    );
  });

  it("lets an admin export any account, and nobody else", async () => {
    const bob = await registerTestUser(rig, "bob");
    const asAdmin = await rig.request(`/api/admin/users/${bob.userId}/export`, {
      headers: authHeaders(alice.token),
    });
    expect(asAdmin.status).toBe(200);
    const asBob = await rig.request(`/api/admin/users/${alice.userId}/export`, {
      headers: authHeaders(bob.token),
    });
    expect(asBob.status).toBe(403);
  });
});

describe("noteToMarkdownFile", () => {
  it("writes frontmatter the Markdown import reads back", () => {
    const file = noteToMarkdownFile({
      id: "n",
      title: "Plan: v2",
      content: "Body",
      color: NoteColor.Default,
      font: NoteFont.Default,
      pinned: true,
      archived: false,
      trashed: false,
      trashedAt: null,
      position: 0,
      tags: ["work", "q3 goals"],
      images: [],
      linkPreviews: [],
      reminder: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    });
    expect(file).toBe(
      [
        "---",
        'title: "Plan: v2"',
        "tags:",
        "  - work",
        "  - q3 goals",
        "pinned: true",
        "created: 2026-01-01T00:00:00.000Z",
        "updated: 2026-02-01T00:00:00.000Z",
        "---",
        "Body",
        "",
      ].join("\n"),
    );
  });
});
