/**
 * The purpose of a token. `api` (`mfp_`) works on the REST API and the sockets,
 * as a session does. `mcp` (`mfm_`) works only at `/api/v1/mcp`, for an AI
 * assistant. Thus, a secret copied into the settings of an assistant can only
 * do what its tools do. `calendar` (`mfc_`) is the secret in the address of a
 * reminder feed (`/api/v1/calendar/<token>.ics`), because a calendar app sends
 * no header. It opens that feed and nothing else.
 */
export const API_TOKEN_KINDS = ["api", "mcp", "calendar"] as const;
export type ApiTokenKind = (typeof API_TOKEN_KINDS)[number];

/**
 * What a token can reach. Each route that a token can call names one, and each
 * socket also names one (`/api/v1/ws` reads notes, `/api/v1/yjs` writes them).
 * A `:write` scope includes its `:read`. A session has all of them. None of
 * them reaches the functions that only a session can use (passwords, tokens,
 * webhooks, admin).
 */
export const API_TOKEN_SCOPES = [
  "notes:read",
  "notes:write",
  "sharing",
  "account:read",
  "account:write",
] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/**
 * The scopes of a token made without scopes. All tokens made before scopes also
 * got only these.
 */
export const DEFAULT_API_TOKEN_SCOPES: readonly ApiTokenScope[] = [
  "notes:read",
  "notes:write",
];

/** If `granted` includes `needed`. A `:write` includes its `:read`. */
export function hasScope(
  granted: readonly ApiTokenScope[],
  needed: ApiTokenScope,
): boolean {
  if (granted.includes(needed)) return true;
  return (
    needed.endsWith(":read") &&
    granted.includes(needed.replace(/:read$/, ":write") as ApiTokenScope)
  );
}

/**
 * A personal API token as listed. Never the secret, which shows one time, in
 * the response that created it.
 */
export interface ApiToken {
  id: string;
  name: string;
  kind: ApiTokenKind;
  scopes: ApiTokenScope[];
  /**
   * The first characters of the secret, so that a user can tell tokens apart.
   */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Null for a token that does not expire. */
  expiresAt: string | null;
  /**
   * For the token of an assistant given through a sign-in in the browser
   * (OAuth): the client that got it. Absent for a manual token. Such a grant
   * gives a new secret each hour. Thus, `prefix` names only the first.
   */
  oauthClientId?: string;
}

export interface ApiTokensResponse {
  tokens: ApiToken[];
}

export interface ApiTokenCreateRequest {
  name: string;
  /** `api` when not given. */
  kind?: ApiTokenKind;
  /**
   * `DEFAULT_API_TOKEN_SCOPES` when not given. An `mcp` token accepts only
   * `notes:*`, which is all that its tools reach.
   */
  scopes?: ApiTokenScope[];
  /** The days until it stops. Not given for a token that does not expire. */
  expiresInDays?: number;
  /**
   * For a token that reaches notes, which the app makes itself: the hash of its
   * secret, the start of the secret that a list of tokens shows, and its keys,
   * wrapped under a key derived from the secret. The server never sees the
   * secret until the token is used. All three, or none.
   */
  tokenHash?: string;
  prefix?: string;
  wrappedKeys?: string;
}

export interface ApiTokenCreatedResponse {
  token: ApiToken;
  /**
   * The bearer token itself, for a token that the server made. It shows this
   * one time. The server keeps only a hash. Absent for a token that the app
   * made, because the server never got its secret.
   */
  secret?: string;
}

/**
 * An assistant that asks for access through OAuth (`GET /api/v1/oauth/client`),
 * as the consent screen shows it. The client id is the address of the own
 * metadata document of the client, or an id that this server gave when the
 * client registered.
 */
export interface OAuthClientInfo {
  clientId: string;
  /** The name that the client gives itself. */
  name: string;
  /**
   * The host that published the metadata document of the client, which vouches
   * for the name. Null for a client that registered itself here. Nobody vouches
   * for its name.
   */
  publisher: string | null;
  /** Where the browser goes after the user answers. */
  redirectUri: string;
  /** What it asked for, of the scopes that an assistant can get. */
  scopes: ApiTokenScope[];
}

/** `POST /api/v1/oauth/authorize`: the signed-in user lets the client in. */
export interface OAuthAuthorizeRequest {
  clientId: string;
  redirectUri: string;
  /** PKCE, only S256. */
  codeChallenge: string;
  /** The value of the client, given back to it unchanged. */
  state?: string;
  /** What the user permitted: `notes:read`, with or without `notes:write`. */
  scopes: ApiTokenScope[];
  /** The days until the grant ends. Not given for a grant that does not end. */
  expiresInDays?: number;
  password?: string;
  /**
   * For a grant that reaches notes: the SHA-256 of a code that the app made,
   * and the keys of the grant wrapped under a key derived from that code. The
   * server sees the code for the first time when the assistant trades it in.
   * They come together.
   */
  codeHash?: string;
  wrappedKeys?: string;
}

export interface OAuthAuthorizeResponse {
  /**
   * The redirect address of the client, for the browser. It has the code when
   * the server made the code. It has no code when the app made it. The app then
   * adds `code` itself.
   */
  redirectTo: string;
}
