import { safeFetch } from "#/linkPreview/safeFetch.ts";
import type { StorageDriver } from "#/storage/types.ts";
import { redirectUriProblem } from "./redirectUris.ts";

/** An OAuth client, as the consent page and the token endpoint need it. */
export interface ResolvedClient {
  id: string;
  name: string;
  /**
   * The host whose metadata document names the client, or null for a client
   * that registered itself here and vouches only for itself.
   */
  publisher: string | null;
  redirectUris: string[];
}

/** Reads the metadata document of a client: its parsed JSON, or a throw. */
export type ClientMetadataFetcher = (url: URL) => Promise<unknown>;

export const MAX_CLIENT_NAME_LENGTH = 100;

/** The name in Settings for a client that gives itself no name. */
export const UNNAMED_CLIENT = "MCP client";

/** The maximum size of a metadata document. The draft asks for 5 KB or less. */
const MAX_METADATA_BYTES = 5 * 1024;

/**
 * How long a fetched document stays valid for its client, and how many are
 * kept.
 */
const METADATA_TTL_MS = 5 * 60 * 1000;
const MAX_CACHED = 256;

/**
 * A client that identifies itself by the address of its own metadata document
 * (a Client ID Metadata Document, the preferred method of the MCP
 * specification): an `https` address with a path, which the server reads and
 * does not store.
 */
export function isMetadataDocumentId(clientId: string): boolean {
  if (!clientId.startsWith("https://")) return false;
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  return (
    url.pathname !== "/" &&
    !url.hash &&
    !url.username &&
    !url.password &&
    url.href === clientId
  );
}

/**
 * The fetcher of production. The document is on an address that the client
 * selected. Thus, it goes through the same guard as a link preview, reaches
 * only public addresses, and does not follow redirects.
 */
export const fetchClientMetadata: ClientMetadataFetcher = async (url) => {
  const fetched = await safeFetch(url, {
    maxBytes: MAX_METADATA_BYTES,
    overflow: "refuse",
    accept: "application/json",
    timeoutMs: 5000,
    maxRedirects: 0,
  });
  return JSON.parse(fetched.body.toString("utf8"));
};

/**
 * The client that a document describes, or null if it does not describe one
 * correctly.
 */
function clientFromDocument(
  clientId: string,
  doc: unknown,
): ResolvedClient | null {
  if (typeof doc !== "object" || doc === null) return null;
  const record = doc as Record<string, unknown>;
  // A document served at one address that claims a different address is not
  // that client.
  if (record.client_id !== clientId) return null;
  const method = record.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return null;
  const uris = record.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 10) {
    return null;
  }
  if (
    !uris.every((uri) => typeof uri === "string" && !redirectUriProblem(uri))
  ) {
    return null;
  }
  const host = new URL(clientId).host;
  const named =
    typeof record.client_name === "string" ? record.client_name.trim() : "";
  return {
    id: clientId,
    name: named.slice(0, MAX_CLIENT_NAME_LENGTH) || host,
    publisher: host,
    redirectUris: uris as string[],
  };
}

/**
 * Finds the client of a `client_id`: a registered client in storage, or a
 * metadata document read (and kept for a few minutes) from its address. Null
 * for a client that the server cannot find, or that does not describe itself
 * correctly.
 */
export function createClientResolver(deps: {
  storage: StorageDriver;
  fetchMetadata?: ClientMetadataFetcher | undefined;
}): (clientId: string) => Promise<ResolvedClient | null> {
  const fetchMetadata = deps.fetchMetadata ?? fetchClientMetadata;
  const cache = new Map<string, { client: ResolvedClient; at: number }>();

  return async (clientId) => {
    if (!isMetadataDocumentId(clientId)) {
      const stored = await deps.storage.oauth.getClient(clientId);
      return stored
        ? {
            id: stored.id,
            name: stored.name,
            publisher: null,
            redirectUris: stored.redirectUris,
          }
        : null;
    }
    const now = Date.now();
    const cached = cache.get(clientId);
    if (cached && cached.at > now - METADATA_TTL_MS) return cached.client;
    let doc: unknown;
    try {
      doc = await fetchMetadata(new URL(clientId));
    } catch {
      // Refused, not available, too large or not JSON: these are all the same
      // for the user, who learns that the server cannot find the app.
      return null;
    }
    const client = clientFromDocument(clientId, doc);
    if (!client) return null;
    cache.delete(clientId);
    cache.set(clientId, { client, at: now });
    // The insertion order is the age order. Thus, the first is the oldest.
    if (cache.size > MAX_CACHED) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return client;
  };
}
