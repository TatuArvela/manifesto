import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../../server/src/test/setup.js";
import { type Client, createClient, ManifestoApiError } from "./index.ts";

/**
 * The client against the real server app, through the token a script would
 * hold: every request it builds has to be one the server takes.
 */
describe("@manifesto/api", () => {
  let rig: TestRig;
  let api: Client;
  let requests: string[];

  /** A personal API token with the given scopes, minted as Settings does. */
  async function mint(session: string, scopes?: string[]): Promise<string> {
    const res = await rig.request("/api/tokens", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        name: "script",
        password: "test-pass-12",
        ...(scopes && { scopes }),
      }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { secret: string }).secret;
  }

  function clientFor(token: string): Client {
    return createClient({
      url: "https://notes.example/",
      token,
      fetch: async (input, init) => {
        const url = String(input);
        requests.push(`${init?.method ?? "GET"} ${url}`);
        return rig.app.request(url.replace("https://notes.example", ""), init);
      },
    });
  }

  let session: string;

  beforeEach(async () => {
    rig = await bootTestApp();
    session = (await registerTestUser(rig, "alice")).token;
    requests = [];
    api = clientFor(await mint(session));
  });

  afterEach(async () => {
    await rig.close();
  });

  it("says whose token it is and what the server offers", async () => {
    await expect(api.me()).rejects.toMatchObject({ status: 403 });
    requests = [];
    const account = clientFor(await mint(session, ["account:read"]));
    expect((await account.me()).user.username).toBe("alice");
    const capabilities = await account.capabilities();
    expect(capabilities.auth.providers).toContain("local");
    expect(requests).toEqual([
      "GET https://notes.example/api/auth/me",
      "GET https://notes.example/api/capabilities",
    ]);
  });

  it("creates a note from its text alone, and reads it back", async () => {
    const made = await api.notes.create({ content: "From a script" });
    expect(made).toMatchObject({
      title: "",
      content: "From a script",
      color: "default",
      pinned: false,
      trashed: false,
      tags: [],
    });
    expect(await api.notes.get(made.id)).toMatchObject({
      id: made.id,
      content: "From a script",
    });
  });

  it("puts a new note ahead of an older one", async () => {
    const first = await api.notes.create({ content: "one" });
    await new Promise((r) => setTimeout(r, 5));
    const second = await api.notes.create({ content: "two" });
    expect(second.position).toBeLessThan(first.position);
  });

  it("changes only the fields given", async () => {
    const made = await api.notes.create({
      title: "Shopping",
      content: "- [ ] milk",
      tags: ["home"],
    });
    const changed = await api.notes.update(made.id, { pinned: true });
    expect(changed).toMatchObject({
      title: "Shopping",
      content: "- [ ] milk",
      tags: ["home"],
      pinned: true,
    });
  });

  it("refuses a stale write when asked to, and hands back the current note", async () => {
    const made = await api.notes.create({ content: "v1" });
    await new Promise((r) => setTimeout(r, 5));
    const current = await api.notes.update(made.id, { content: "v2" });

    const stale = await api.notes
      .update(made.id, { content: "v3" }, { ifMatch: made.updatedAt })
      .catch((err: unknown) => err);
    expect(stale).toBeInstanceOf(ManifestoApiError);
    expect(stale).toMatchObject({ status: 412 });
    expect((stale as ManifestoApiError).current?.content).toBe("v2");

    const landed = await api.notes.update(
      made.id,
      { content: "v3" },
      { ifMatch: current.updatedAt },
    );
    expect(landed.content).toBe("v3");
  });

  it("trashes, restores and deletes", async () => {
    const made = await api.notes.create({ content: "going" });
    expect((await api.notes.trash(made.id)).trashed).toBe(true);
    expect((await api.notes.restore(made.id)).trashed).toBe(false);
    await api.notes.delete(made.id);
    await expect(api.notes.get(made.id)).rejects.toMatchObject({ status: 404 });
  });

  it("pages through every note", async () => {
    for (let i = 0; i < 5; i++) await api.notes.create({ content: `n${i}` });
    requests = [];

    const page = await api.notes.list({ limit: 2 });
    expect(page.notes).toHaveLength(2);
    expect(page.nextCursor).not.toBeNull();

    const seen: string[] = [];
    for await (const note of api.notes.all({ limit: 2 }))
      seen.push(note.content);
    expect(seen.sort()).toEqual(["n0", "n1", "n2", "n3", "n4"]);
    // One list above, then three pages for five notes at two a page.
    expect(requests).toHaveLength(4);
  });

  it("searches, across pages too", async () => {
    await api.notes.create({ title: "Train tickets", content: "Helsinki" });
    await api.notes.create({ content: "train times for Tampere" });
    await api.notes.create({ content: "unrelated" });

    const found = await api.notes.search("train");
    expect(found.notes).toHaveLength(2);
    const all: string[] = [];
    for await (const note of api.notes.searchAll("train", { limit: 1 })) {
      all.push(note.id);
    }
    expect(all).toHaveLength(2);
    expect((await api.notes.search("   ")).notes).toEqual([]);
  });

  it("throws what the server refused, with its status", async () => {
    const reader = clientFor(await mint(session, ["notes:read"]));
    await expect(reader.notes.create({ content: "no" })).rejects.toMatchObject({
      name: "ManifestoApiError",
      status: 403,
    });
    await expect(
      clientFor("mfp_not-a-token").notes.list(),
    ).rejects.toMatchObject({ status: 401 });
    await expect(api.notes.get("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("fetches the bytes of an image a note names", async () => {
    const bytes = Buffer.from(`${"iVBORw0KGgo".repeat(4)}=`, "base64");
    const upload = await rig.request("/api/attachments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "image/png",
      },
      body: bytes as BodyInit,
    });
    expect(upload.status).toBe(201);
    const { ref } = (await upload.json()) as { ref: string };
    const note = await api.notes.create({ content: "pictured", images: [ref] });
    const [held = ""] = (await api.notes.get(note.id)).images;
    expect(held).toBe(ref);

    const image = await api.images.get(held);
    expect(image.type).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
    const bare = await api.images.get(held.replace("attachment:", ""));
    expect(bare.size).toBe(bytes.length);
  });

  it("passes on how long a 429 asks to wait, and nothing when it does not say", async () => {
    const limited = (headers: Record<string, string>) =>
      createClient({
        url: "https://notes.example",
        token: "t",
        fetch: async () =>
          Response.json(
            { error: "Too many requests" },
            { status: 429, headers },
          ),
      }).notes.list();

    await expect(limited({ "Retry-After": "30" })).rejects.toMatchObject({
      status: 429,
      message: "Too many requests",
      retryAfter: 30,
    });
    await expect(limited({})).rejects.toMatchObject({
      status: 429,
      retryAfter: undefined,
    });
  });

  it("says so when the server cannot be reached", async () => {
    const offline = createClient({
      url: "https://notes.example",
      token: "t",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const err = await offline.me().catch((e: unknown) => e);
    expect(err).toMatchObject({ name: "ManifestoApiError", status: 0 });
    expect((err as Error).cause).toBeInstanceOf(TypeError);
  });
});
