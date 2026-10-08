import type { LinkPreview, NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { buildOpenApiDocument, OPERATIONS, operationId } from "./openapi.js";
import {
  authHeaders,
  bootTestAppWith,
  registerTestUser,
  type TestRig,
} from "./test/setup.js";

/**
 * A client generated from the document is only as right as the document. The
 * request bodies are the zod schemas the routes validate with, so they cannot
 * drift; the response shapes are written by hand, so here the server's real
 * answers are checked against them: every required property present, every
 * type as declared, and nothing answered that the document does not mention.
 * The last is checked here and not by the schemas, which stay open so that a
 * client generated today still reads a server that has since added a field.
 */

/** As much of a JSON schema as the document's responses use. */
interface Described {
  $ref?: string;
  anyOf?: Described[];
  items?: Described;
  properties?: Record<string, Described>;
  additionalProperties?: unknown;
}

const doc = buildOpenApiDocument("test") as unknown as {
  components: { schemas: Record<string, Described> };
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

/** The schema a `$ref` names, or the schema itself. */
function resolved(schema: Described): Described {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  const target = doc.components.schemas[name];
  if (!target) throw new Error(`Nothing is called ${name}`);
  return resolved(target);
}

/** The response schema the document gives an operation for a status. */
function referenceFor(method: string, path: string, status: number) {
  const reference =
    doc.paths[path]?.[method]?.responses[String(status)]?.content?.[
      "application/json"
    ].schema.$ref;
  if (!reference) {
    throw new Error(`${method} ${path} documents no ${status} body`);
  }
  return reference;
}

/** That schema as something an answer can be parsed with. */
function parserFor(reference: string) {
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

/**
 * Where an answer holds a property its schema does not declare. An object
 * described without properties, or with `additionalProperties` of its own
 * (the preferences, the features), is open by its description and holds
 * anything.
 */
function undeclared(schema: Described, value: unknown, at = ""): string[] {
  const described = resolved(schema);
  if (described.anyOf) {
    // Null or one thing, everywhere the document says `anyOf`.
    return described.anyOf.flatMap((option) =>
      value === null ? [] : undeclared(option, value, at),
    );
  }
  if (Array.isArray(value)) {
    const { items } = described;
    if (!items) return [];
    return value.flatMap((item, i) => undeclared(items, item, `${at}[${i}]`));
  }
  const { properties } = described;
  if (value === null || typeof value !== "object" || !properties) return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    const property = properties[key];
    if (property) return undeclared(property, inner, `${at}.${key}`);
    return described.additionalProperties === undefined ? [`${at}.${key}`] : [];
  });
}

const PREVIEW: LinkPreview = {
  url: "https://example.com/post",
  title: "A post",
  description: "About something",
  domain: "example.com",
};

// The smallest thing the upload takes for an image.
const PNG = Buffer.from(`${"iVBORw0KGgo".repeat(4)}=`, "base64");

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
    const reference = referenceFor(method, template, expected);
    const parsed = parserFor(reference).safeParse(res.body);
    expect(
      parsed.success ? [] : parsed.error.issues,
      `${method} ${template} ${expected}`,
    ).toEqual([]);
    expect(
      undeclared({ $ref: reference }, res.body),
      `${method} ${template} ${expected} answers more than is documented`,
    ).toEqual([]);
    return res.body as T;
  }

  beforeEach(async () => {
    rig = await bootTestAppWith({}, { fetchLinkPreview: async () => PREVIEW });
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
    await conforms(owner, "get", "/api/auth/me", "/api/auth/me", 200);
    await conforms(owner, "put", "/api/auth/me", "/api/auth/me", 200, {
      email: "olivia@example.com",
      password: "test-pass-12",
    });
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
    type Shared = {
      note: { sharing: { role: string; members: object[] } };
    };
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
    expect(shared.note.sharing.members).toHaveLength(1);
    expect(accepted.note.sharing.role).toBe("edit");
  });

  it("describes a note shared with a team, and the team on it", async () => {
    // The first account registered is the admin, and a note goes only to a
    // team its owner is in.
    const team = await call(owner, "post", "/api/admin/teams", {
      name: "Travellers",
      memberIds: [owner.userId, other.userId],
    });
    expect(team.status).toBe(201);
    const teamId = (team.body as { team: { id: string } }).team.id;
    const created = await call(owner, "post", "/api/notes", baseNote);
    const id = (created.body as { note: { id: string } }).note.id;
    const shares = `/api/notes/${id}/team-shares`;
    const template = "/api/notes/{id}/team-shares";

    await conforms(owner, "post", template, shares, 201, {
      teamId,
      role: "view",
    });
    await conforms(owner, "get", template, shares, 200);
    await conforms(
      owner,
      "put",
      `${template}/{teamId}`,
      `${shares}/${teamId}`,
      200,
      { role: "edit" },
    );

    // Both carry the team, which a note shared directly leaves out.
    const invited = await conforms<{ invitations: { team?: object }[] }>(
      other,
      "get",
      "/api/invitations",
      "/api/invitations",
      200,
    );
    expect(invited.invitations[0]?.team).toEqual({
      id: teamId,
      name: "Travellers",
    });
    const note = await conforms<{
      note: { sharing: { members: { team?: object }[] } };
    }>(owner, "get", "/api/notes/{id}", `/api/notes/${id}`, 200);
    expect(note.note.sharing.members[0]?.team).toEqual({
      id: teamId,
      name: "Travellers",
    });
  });

  it("describes the comments beside a shared note", async () => {
    const created = await call(owner, "post", "/api/notes", baseNote);
    const id = (created.body as { note: { id: string } }).note.id;
    await call(owner, "post", `/api/notes/${id}/shares`, {
      userId: other.userId,
      role: "edit",
    });
    await call(other, "post", `/api/invitations/${id}/accept`);
    const comments = `/api/notes/${id}/comments`;
    const template = "/api/notes/{id}/comments";

    const written = await conforms<{ comment: { id: string } }>(
      other,
      "post",
      template,
      comments,
      201,
      { body: "Window seats?" },
    );
    await conforms(
      other,
      "put",
      `${template}/{commentId}`,
      `${comments}/${written.comment.id}`,
      200,
      { body: "Aisle seats?" },
    );
    // Once its author has left the note, a comment stays without a name.
    const left = await rig.request(`/api/notes/${id}/shares/${other.userId}`, {
      method: "DELETE",
      headers: authHeaders(owner.token),
    });
    expect(left.status).toBe(204);
    const listed = await conforms<{ comments: { author: object | null }[] }>(
      owner,
      "get",
      template,
      comments,
      200,
    );
    expect(listed.comments.map((comment) => comment.author)).toEqual([null]);
  });

  it("describes an upload and a link preview", async () => {
    const res = await rig.request("/api/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${owner.token}`,
        "Content-Type": "image/png",
      },
      body: PNG,
    });
    expect(res.status).toBe(201);
    const reference = referenceFor("post", "/api/attachments", 201);
    const uploaded: unknown = await res.json();
    expect(parserFor(reference).safeParse(uploaded).success).toBe(true);
    expect(undeclared({ $ref: reference }, uploaded)).toEqual([]);

    const preview = await conforms<{ preview: LinkPreview | null }>(
      owner,
      "get",
      "/api/link-preview",
      `/api/link-preview?url=${encodeURIComponent(PREVIEW.url)}`,
      200,
    );
    expect(preview.preview).toEqual(PREVIEW);
  });

  it("notices an answer that says more than the document does", () => {
    const reference = referenceFor("get", "/api/invitations", 200);
    const invitation = {
      noteId: "n",
      owner: { id: "u", username: "o", displayName: "O", avatarColor: "red" },
      nickname: "new",
    };
    expect(
      undeclared({ $ref: reference }, { invitations: [invitation], more: 1 }),
    ).toEqual([".invitations[0].nickname", ".more"]);
    // What is described as holding anything does.
    const prefs = referenceFor("get", "/api/auth/me/prefs", 200);
    expect(undeclared({ $ref: prefs }, { prefs: { theme: "dark" } })).toEqual(
      [],
    );
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

    const open = await conforms<{ link: { token: string } }>(
      owner,
      "post",
      "/api/notes/{id}/links",
      `/api/notes/${id}/links`,
      201,
      { mode: "snapshot" },
    );
    await conforms(
      null,
      "get",
      "/api/public/{token}",
      `/api/public/${open.link.token}`,
      200,
    );
  });
});
