import type { NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument, OPERATIONS, operationId } from "./openapi.js";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "./test/setup.js";

/**
 * A client generated from the document is only as right as the document. The
 * request bodies are the zod schemas the routes validate with, so they cannot
 * drift; the response shapes are written by hand, so here the server's real
 * answers are checked against them: every required property present, every
 * type as declared, and nothing answered that the document does not mention.
 */

const doc = buildOpenApiDocument("test") as unknown as {
  components: { schemas: Record<string, { properties?: object }> };
  paths: Record<
    string,
    Record<
      string,
      {
        operationId: string;
        responses: Record<
          string,
          { content?: { "application/json": { schema: { $ref: string } } } }
        >;
      }
    >
  >;
};

/** The response schema the document gives an operation for a status. */
function schemaFor(method: string, path: string, status: number) {
  const reference =
    doc.paths[path]?.[method]?.responses[String(status)]?.content?.[
      "application/json"
    ].schema.$ref;
  if (!reference) {
    throw new Error(`${method} ${path} documents no ${status} body`);
  }
  // zod resolves references into `$defs`, so the components go there.
  const local = <T>(value: T) =>
    JSON.parse(
      JSON.stringify(value).replaceAll("#/components/schemas/", "#/$defs/"),
    ) as T;
  return z.fromJSONSchema({
    $ref: local(reference),
    $defs: local(doc.components.schemas),
  } as Parameters<typeof z.fromJSONSchema>[0]);
}

/** The properties a named component declares, nested objects aside. */
const declared = (name: string) =>
  Object.keys(doc.components.schemas[name]?.properties ?? {}).sort();

const baseNote: NoteCreate = {
  title: "Trip plan",
  content: "- [ ] Tickets",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: ["travel"],
  images: [],
  linkPreviews: [],
  reminder: null,
};

describe("the OpenAPI document against the server's answers", () => {
  let rig: TestRig;
  let owner: { token: string; userId: string };
  let other: { token: string; userId: string };

  async function call(
    who: { token: string } | null,
    method: string,
    path: string,
    body?: unknown,
  ) {
    const res = await rig.request(path, {
      method: method.toUpperCase(),
      headers: who
        ? authHeaders(who.token)
        : { "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  }

  /** Calls the server and holds the answer to the document. */
  async function conforms<T = unknown>(
    who: { token: string } | null,
    method: string,
    template: string,
    path: string,
    expected: number,
    body?: unknown,
  ) {
    const res = await call(who, method, path, body);
    expect(res.status, `${method} ${path}`).toBe(expected);
    const parsed = schemaFor(method, template, expected).safeParse(res.body);
    expect(
      parsed.success ? [] : parsed.error.issues,
      `${method} ${template} ${expected}`,
    ).toEqual([]);
    return res.body as T;
  }

  beforeEach(async () => {
    rig = await bootTestApp();
    owner = await registerTestUser(rig, "olivia");
    other = await registerTestUser(rig, "alice");
  });

  afterEach(async () => {
    await rig.close();
  });

  it("gives every operation a name of its own", () => {
    const ids = OPERATIONS.map(operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(operationId({ method: "get", path: "/api/notes/:id" })).toBe(
      "getNotesById",
    );
    expect(
      operationId({
        method: "put",
        path: "/api/notes/:id/team-shares/:teamId",
      }),
    ).toBe("putNotesByIdTeamSharesByTeamId");
    expect(doc.paths["/api/notes"]?.get?.operationId).toBe("getNotes");
    for (const id of ids) expect(id).toMatch(/^[a-z][A-Za-z0-9]+$/);
  });

  it("describes the server, the account and its preferences", async () => {
    await conforms(null, "get", "/api/health", "/api/health", 200);
    await conforms(null, "get", "/api/capabilities", "/api/capabilities", 200);
    const me = await conforms<{ user: object }>(
      owner,
      "get",
      "/api/auth/me",
      "/api/auth/me",
      200,
    );
    expect(Object.keys(me.user).sort()).toEqual(declared("AuthUser"));
    await conforms(
      owner,
      "get",
      "/api/auth/me/prefs",
      "/api/auth/me/prefs",
      200,
    );
  });

  it("describes a note in every answer that carries one", async () => {
    const created = await conforms<{ note: { id: string } }>(
      owner,
      "post",
      "/api/notes",
      "/api/notes",
      201,
      baseNote,
    );
    const id = created.note.id;
    await conforms(owner, "get", "/api/notes/{id}", `/api/notes/${id}`, 200);
    await conforms(owner, "put", "/api/notes/{id}", `/api/notes/${id}`, 200, {
      pinned: true,
    });
    await conforms(owner, "get", "/api/notes", "/api/notes?limit=10", 200);
    await conforms(owner, "get", "/api/search", "/api/search?q=trip", 200);
    await conforms(owner, "get", "/api/sync", "/api/sync", 200);
    await conforms(owner, "get", "/api/notes/{id}", "/api/notes/nope", 404);
    await conforms(
      owner,
      "post",
      "/api/notes/import",
      "/api/notes/import",
      200,
      { notes: [{ ...baseNote, id, createdAt: "2026-01-01T00:00:00.000Z" }] },
    );
    await conforms(
      owner,
      "get",
      "/api/notes/{id}/versions",
      `/api/notes/${id}/versions`,
      200,
    );
  });

  it("describes sharing: the lookup, the invitation, and who is on the note", async () => {
    const created = await call(owner, "post", "/api/notes", baseNote);
    const id = (created.body as { note: { id: string } }).note.id;

    await conforms(owner, "get", "/api/users", "/api/users?q=alice", 200);
    type Shared = { note: { sharing: object } };
    const shared = await conforms<Shared>(
      owner,
      "post",
      "/api/notes/{id}/shares",
      `/api/notes/${id}/shares`,
      201,
      { userId: other.userId, role: "edit" },
    );
    await conforms(other, "get", "/api/invitations", "/api/invitations", 200);
    const accepted = await conforms<Shared>(
      other,
      "post",
      "/api/invitations/{noteId}/accept",
      `/api/invitations/${id}/accept`,
      200,
    );
    await conforms(owner, "get", "/api/teams", "/api/teams", 200);

    // Nothing in a shared note that the document leaves out.
    for (const note of [shared.note, accepted.note]) {
      for (const key of Object.keys(note)) {
        expect(declared("Note"), key).toContain(key);
      }
      expect(Object.keys(note.sharing).sort()).toEqual(declared("NoteSharing"));
    }
  });

  it("describes public links and the note they show", async () => {
    const created = await call(owner, "post", "/api/notes", baseNote);
    const id = (created.body as { note: { id: string } }).note.id;
    const made = await conforms<{ link: { token: string } }>(
      owner,
      "post",
      "/api/notes/{id}/links",
      `/api/notes/${id}/links`,
      201,
      { mode: "live", password: "test-pass-12" },
    );
    expect(Object.keys(made.link).sort()).toEqual(declared("PublicLink"));
    await conforms(
      owner,
      "get",
      "/api/notes/{id}/links",
      `/api/notes/${id}/links`,
      200,
    );
    const { token } = made.link;
    await conforms(
      null,
      "get",
      "/api/public/{token}",
      `/api/public/${token}`,
      401,
    );
    await conforms(
      null,
      "post",
      "/api/public/{token}/unlock",
      `/api/public/${token}/unlock`,
      200,
      { password: "test-pass-12" },
    );
  });
});
