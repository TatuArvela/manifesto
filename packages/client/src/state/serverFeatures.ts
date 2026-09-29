import {
  API_TOKEN_KINDS,
  type ApiTokenKind,
  type CapabilitiesResponse,
  SERVER_FEATURES,
  type ServerFeature,
} from "@manifesto/shared";
import { signal } from "@preact/signals";

/** What the connected server has on: each feature a host can turn off, and
 * whether an assistant can sign in to its MCP endpoint. */
export type ServerFeatures = Record<ServerFeature, boolean> & {
  mcpSignIn: boolean;
};

/**
 * What the client assumes until the server says: what a server from before
 * these switches offered, so one that does not report a feature keeps showing
 * it. The optional ones (webhooks, public links, MCP, an admin's export) are
 * shown only once the server has said they are on.
 */
export const DEFAULT_SERVER_FEATURES: ServerFeatures = {
  sharing: true,
  teams: true,
  publicLinks: false,
  linkPreviews: true,
  calendar: true,
  apiTokens: true,
  mcp: false,
  webhooks: false,
  passkeys: true,
  twoFactor: true,
  adminExport: false,
  mcpSignIn: false,
};

/**
 * The server's features, from `GET /api/capabilities` (`fetchCapabilities`).
 * Read through `serverFeature`, and only where the server is in play: open
 * mode has none of these and never asks.
 */
export const serverFeatures = signal<ServerFeatures>(DEFAULT_SERVER_FEATURES);

/** Whether the connected server has this feature on. */
export function serverFeature(feature: keyof ServerFeatures): boolean {
  return serverFeatures.value[feature];
}

/** The feature each kind of token belongs to, as the server counts them. */
const TOKEN_KIND_FEATURES: Record<ApiTokenKind, ServerFeature> = {
  api: "apiTokens",
  mcp: "mcp",
  calendar: "calendar",
};

/** The kinds of token this server will mint, in the order they are offered. */
export function offeredTokenKinds(): ApiTokenKind[] {
  return API_TOKEN_KINDS.filter((kind) =>
    serverFeature(TOKEN_KIND_FEATURES[kind]),
  );
}

/** Takes in what the capabilities say, keeping the default for anything an
 * older server leaves out. */
export function adoptServerFeatures(
  reported: Partial<CapabilitiesResponse["features"]>,
): void {
  const next = { ...DEFAULT_SERVER_FEATURES };
  for (const feature of [...SERVER_FEATURES, "mcpSignIn"] as const) {
    const value = reported[feature];
    if (typeof value === "boolean") next[feature] = value;
  }
  serverFeatures.value = next;
}
