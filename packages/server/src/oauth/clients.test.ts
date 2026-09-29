import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ClientMetadataFetcher,
  createClientResolver,
  isMetadataDocumentId,
  MAX_CLIENT_NAME_LENGTH,
} from "./clients.js";

type Storage = Parameters<typeof createClientResolver>[0]["storage"];

const CLIENT_ID = "https://assistant.example/oauth/client.json";
const REDIRECT = "http://127.0.0.1:3000/callback";

/** Storage holding one registered client, and nothing else of use. */
function storageWith(
  clients: Record<string, { name: string; redirectUris: string[] }> = {},
): { storage: Storage; lookups: string[] } {
  const lookups: string[] = [];
  const storage = {
    oauth: {
      getClient: async (id: string) => {
        lookups.push(id);
        const found = clients[id];
        return found
          ? {
              id,
              ...found,
              createdAt: "2026-01-01T00:00:00.000Z",
              lastUsedAt: null,
            }
          : null;
      },
    },
  } as unknown as Storage;
  return { storage, lookups };
}

function resolverServing(
  document: unknown,
  { storage = storageWith().storage }: { storage?: Storage } = {},
) {
  const fetched: string[] = [];
  const fetchMetadata: ClientMetadataFetcher = async (url) => {
    fetched.push(url.href);
    if (document instanceof Error) throw document;
    return typeof document === "function" ? document() : document;
  };
  return { resolve: createClientResolver({ storage, fetchMetadata }), fetched };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("isMetadataDocumentId", () => {
  it("takes an https address with a path, written as a browser would", () => {
    expect(isMetadataDocumentId(CLIENT_ID)).toBe(true);
    expect(isMetadataDocumentId("https://a.example/c?v=1")).toBe(true);
  });

  it("leaves anything else to the registered clients", () => {
    for (const id of [
      "01J0000000000000000000000",
      "http://assistant.example/client.json",
      "https://assistant.example/",
      "https://assistant.example",
      "https://assistant.example/client.json#frag",
      "https://user:pw@assistant.example/client.json",
      // Not in the form the URL parser writes, so a document could claim a
      // different spelling of the address it was fetched from.
      "https://ASSISTANT.example/client.json",
      "https://assistant.example/a/../client.json",
      "https://",
    ]) {
      expect(isMetadataDocumentId(id), id).toBe(false);
    }
  });
});

describe("createClientResolver", () => {
  it("finds a registered client in storage and never fetches for it", async () => {
    const { storage, lookups } = storageWith({
      reg1: { name: "Desktop", redirectUris: [REDIRECT] },
    });
    const { resolve, fetched } = resolverServing({}, { storage });
    expect(await resolve("reg1")).toEqual({
      id: "reg1",
      name: "Desktop",
      publisher: null,
      redirectUris: [REDIRECT],
    });
    expect(await resolve("nobody")).toBeNull();
    expect(lookups).toEqual(["reg1", "nobody"]);
    expect(fetched).toEqual([]);
  });

  it("reads a client from its document, named by its host when it names nothing", async () => {
    const { resolve } = resolverServing({
      client_id: CLIENT_ID,
      redirect_uris: [REDIRECT],
    });
    expect(await resolve(CLIENT_ID)).toEqual({
      id: CLIENT_ID,
      name: "assistant.example",
      publisher: "assistant.example",
      redirectUris: [REDIRECT],
    });
  });

  it("trims a name and cuts one that is too long", async () => {
    const { resolve } = resolverServing({
      client_id: CLIENT_ID,
      client_name: `  ${"A".repeat(MAX_CLIENT_NAME_LENGTH + 50)}  `,
      redirect_uris: [REDIRECT],
    });
    const client = await resolve(CLIENT_ID);
    expect(client?.name).toBe("A".repeat(MAX_CLIENT_NAME_LENGTH));
  });

  it("refuses a document that does not describe a public client properly", async () => {
    const documents: unknown[] = [
      null,
      "a string",
      [],
      { redirect_uris: [REDIRECT] },
      { client_id: `${CLIENT_ID}?other`, redirect_uris: [REDIRECT] },
      {
        client_id: CLIENT_ID,
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "client_secret_basic",
      },
      { client_id: CLIENT_ID },
      { client_id: CLIENT_ID, redirect_uris: [] },
      { client_id: CLIENT_ID, redirect_uris: REDIRECT },
      { client_id: CLIENT_ID, redirect_uris: [REDIRECT, 42] },
      { client_id: CLIENT_ID, redirect_uris: ["javascript:alert(1)"] },
      { client_id: CLIENT_ID, redirect_uris: ["http://evil.example/cb"] },
      {
        client_id: CLIENT_ID,
        redirect_uris: Array.from(
          { length: 11 },
          (_, i) => `https://a.example/${i}`,
        ),
      },
    ];
    for (const document of documents) {
      const { resolve } = resolverServing(document);
      expect(await resolve(CLIENT_ID), JSON.stringify(document)).toBeNull();
    }
  });

  it("accepts a document that says it is public in so many words", async () => {
    const { resolve } = resolverServing({
      client_id: CLIENT_ID,
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
    });
    expect(await resolve(CLIENT_ID)).not.toBeNull();
  });

  it("answers null when the document cannot be read, and tries again next time", async () => {
    const { resolve, fetched } = resolverServing(new Error("unreachable"));
    expect(await resolve(CLIENT_ID)).toBeNull();
    expect(await resolve(CLIENT_ID)).toBeNull();
    expect(fetched).toEqual([CLIENT_ID, CLIENT_ID]);
  });

  it("keeps a document for a few minutes, then reads it again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
    let name = "First";
    const { resolve, fetched } = resolverServing(() => ({
      client_id: CLIENT_ID,
      client_name: name,
      redirect_uris: [REDIRECT],
    }));
    expect((await resolve(CLIENT_ID))?.name).toBe("First");
    name = "Second";
    vi.setSystemTime(new Date("2026-09-01T12:04:00.000Z"));
    expect((await resolve(CLIENT_ID))?.name).toBe("First");
    vi.setSystemTime(new Date("2026-09-01T12:06:00.000Z"));
    expect((await resolve(CLIENT_ID))?.name).toBe("Second");
    expect(fetched).toHaveLength(2);
  });

  it("does not keep a refusal, so a fixed document is read at once", async () => {
    let document: unknown = { client_id: "https://elsewhere.example/c" };
    const { resolve } = resolverServing(() => document);
    expect(await resolve(CLIENT_ID)).toBeNull();
    document = { client_id: CLIENT_ID, redirect_uris: [REDIRECT] };
    expect(await resolve(CLIENT_ID)).not.toBeNull();
  });
});
