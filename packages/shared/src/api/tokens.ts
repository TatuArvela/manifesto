/**
 * What a token is for. `api` (`mfp_`) works on the REST API and the sockets,
 * as a session does; `mcp` (`mfm_`) works only at `/api/v1/mcp`, for an AI
 * assistant, so a secret copied into an assistant's settings can do only what
 * its tools do; `calendar` (`mfc_`) is the secret in a reminder feed's
 * address (`/api/v1/calendar/<token>.ics`), since a calendar app sends no
 * header, and opens that feed and nothing else.
 */
export const API_TOKEN_KINDS = ["api", "mcp", "calendar"] as const;
export type ApiTokenKind = (typeof API_TOKEN_KINDS)[number];

/**
 * What a token may reach. Each route a token can call names one, and so does
 * each socket (`/api/v1/ws` reads notes, `/api/v1/yjs` writes them). A `:write`
 * scope includes its `:read`. A session has them all, and none of them
 * reaches what only a session may do (passwords, tokens, webhooks, admin).
 */
export const API_TOKEN_SCOPES = [
  "notes:read",
  "notes:write",
  "sharing",
  "account:read",
  "account:write",
] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** What a token gets when minted without naming any, and what every token
 * minted before scopes was narrowed to. */
export const DEFAULT_API_TOKEN_SCOPES: readonly ApiTokenScope[] = [
  "notes:read",
  "notes:write",
];

/** Whether `granted` covers `needed`, a `:write` covering its `:read`. */
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
 * A personal API token as listed: never the secret, which is shown once, in
 * the response that created it.
 */
export interface ApiToken {
  id: string;
  name: string;
  kind: ApiTokenKind;
  scopes: ApiTokenScope[];
  /** The secret's first characters, so a user can tell tokens apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  /** Null for a token that does not expire. */
  expiresAt: string | null;
  /**
   * For an assistant's token given by signing in through the browser (OAuth),
   * the client it was given to; absent for one minted by hand. Such a grant
   * hands out a new secret every hour, so `prefix` names only its first.
   */
  oauthClientId?: string;
}

export interface ApiTokensResponse {
  tokens: ApiToken[];
}

export interface ApiTokenCreateRequest {
  name: string;
  /** `api` when left out. */
  kind?: ApiTokenKind;
  /** `DEFAULT_API_TOKEN_SCOPES` when left out. An `mcp` token takes only
   * `notes:*`, which is all its tools reach. */
  scopes?: ApiTokenScope[];
  /** Days until it stops working; left out for a token that does not expire. */
  expiresInDays?: number;
  /**
   * For a token that reaches notes, which the app makes itself: the hash of
   * its secret, the start of the secret that a list of tokens shows, and the
   * keys it carries, wrapped under a key derived from the secret. The server
   * never sees the secret until the token is used. All three, or none.
   */
  tokenHash?: string;
  prefix?: string;
  wrappedKeys?: string;
}

export interface ApiTokenCreatedResponse {
  token: ApiToken;
  /**
   * The bearer token itself, for one the server made. Shown this once; the
   * server keeps only a hash. Absent for a token the app made, whose secret
   * the server was never told.
   */
  secret?: string;
}

/**
 * An assistant asking to be let in by OAuth (`GET /api/v1/oauth/client`), as the
 * consent screen shows it. The client id is the address of the client's own
 * metadata document, or one this server gave out when the client registered.
 */
export interface OAuthClientInfo {
  clientId: string;
  /** What the client calls itself. */
  name: string;
  /**
   * The host that published the client's metadata document, which vouches
   * for the name; null for a client that registered itself here, whose name
   * nobody vouches for.
   */
  publisher: string | null;
  /** Where the browser goes once the user answers. */
  redirectUri: string;
  /** What it asked for, of what an assistant can be given. */
  scopes: ApiTokenScope[];
}

/** `POST /api/v1/oauth/authorize`: the signed-in user lets the client in. */
export interface OAuthAuthorizeRequest {
  clientId: string;
  redirectUri: string;
  /** PKCE, S256 only. */
  codeChallenge: string;
  /** The client's, handed back to it untouched. */
  state?: string;
  /** What the user granted: `notes:read`, with or without `notes:write`. */
  scopes: ApiTokenScope[];
  /** Days until the grant ends; left out for one that does not. */
  expiresInDays?: number;
  password?: string;
  /**
   * For a grant that reaches notes: the SHA-256 of a code the app made, and
   * the keys the grant carries wrapped under a key derived from that code.
   * The server first sees the code when the assistant trades it in. They
   * come together.
   */
  codeHash?: string;
  wrappedKeys?: string;
}

export interface OAuthAuthorizeResponse {
  /**
   * The client's redirect address, to send the browser to: with the code on
   * it when the server made the code, and without when the app did, which
   * then adds `code` itself.
   */
  redirectTo: string;
}
