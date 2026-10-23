import {
  API_TOKEN_KINDS,
  type ApiTokenKind,
  type CapabilitiesResponse,
  SERVER_FEATURES,
  type ServerFeature,
} from "@manifesto/shared";
import { signal } from "@preact/signals";

/**
 * What the connected server has on: each feature that a host can turn off, and
 * if an assistant can sign in to its MCP endpoint.
 */
export type ServerFeatures = Record<ServerFeature, boolean> & {
  mcpSignIn: boolean;
};

/**
 * What the client thinks until the server tells: what a server from before
 * these switches offered. Thus, a server that does not report a feature
 * continues to show it. The optional features (webhooks, public links, MCP, an
 * export by an admin) show only after the server said that they are on. So does
 * the sign-in by a mailed link and by a QR code, which an older server does
 * not have.
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
  magicLinks: false,
  deviceLinks: false,
  pushReminders: false,
  twoFactor: true,
  mcpSignIn: false,
};

/**
 * The features of the server, from `GET /api/v1/capabilities`
 * (`fetchCapabilities`). Read through `serverFeature`, and only where the
 * server is used. Open mode has none of these, and never asks.
 */
export const serverFeatures = signal<ServerFeatures>(DEFAULT_SERVER_FEATURES);

/** If the connected server has this feature on. */
export function serverFeature(feature: keyof ServerFeatures): boolean {
  return serverFeatures.value[feature];
}

/**
 * The feature to which each kind of token belongs, as the server counts them.
 */
const TOKEN_KIND_FEATURES: Record<ApiTokenKind, ServerFeature> = {
  api: "apiTokens",
  mcp: "mcp",
  calendar: "calendar",
};

/**
 * The kinds of token that this server will make, in the order in which they are
 * offered.
 */
export function offeredTokenKinds(): ApiTokenKind[] {
  return API_TOKEN_KINDS.filter((kind) =>
    serverFeature(TOKEN_KIND_FEATURES[kind]),
  );
}

/**
 * Takes in what the capabilities say, and keeps the default for each value that
 * an older server does not include.
 */
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
