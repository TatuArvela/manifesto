import type { ApiToken, ApiTokenScope } from "@manifesto/shared";

// API tokens, and the OAuth server that hands them to assistants.

export interface StoredApiToken extends ApiToken {
  userId: string;
  /** When an OAuth grant's current access token lapses; null for a token
   * minted by hand, whose secret lasts as long as the token. */
  accessExpiresAt: string | null;
}

/** An OAuth grant's secrets, replaced together at every refresh. */
export interface OAuthGrantSecrets {
  tokenHash: string;
  refreshHash: string;
  accessExpiresAt: string;
}

/**
 * Personal API tokens, keyed by the SHA-256 of the secret. An assistant's
 * OAuth grant is one of them (`oauthClientId` set), with a refresh token
 * beside the access token.
 */
export interface ApiTokensRepo {
  create(
    input: StoredApiToken & { tokenHash: string; refreshHash?: string },
  ): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredApiToken | null>;
  /** The grant whose current refresh token this is. */
  findByRefreshHash(refreshHash: string): Promise<StoredApiToken | null>;
  /** The grant whose refresh token this was until its last refresh. */
  findByPreviousRefreshHash(
    refreshHash: string,
  ): Promise<StoredApiToken | null>;
  /**
   * Replace a grant's secrets, if `refreshHash` is still its refresh token.
   * One statement, so of two refreshes with the same token only one wins.
   * The old refresh token is kept as the previous one.
   */
  rotate(refreshHash: string, next: OAuthGrantSecrets): Promise<boolean>;
  listByUser(userId: string): Promise<ApiToken[]>;
  /** The user's token, so one user cannot revoke another's. Returns the
   * deleted token's hash, which names the sockets it opened, or null. */
  delete(id: string, userId: string): Promise<string | null>;
  deleteByUser(userId: string): Promise<number>;
  touch(id: string, lastUsedAt: string): Promise<void>;
  deleteExpired(nowIso: string): Promise<number>;
}

/** An OAuth client that registered itself (`POST /api/oauth/register`). */
export interface StoredOAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
  /** When it was last given a grant; null until the first. */
  lastUsedAt: string | null;
}

/** What a consent hands out: good once, until `expiresAt`. */
export interface StoredOAuthCode {
  codeHash: string;
  clientId: string;
  /** Kept for the grant's name, since a client that identifies itself by
   * its metadata document is not stored. */
  clientName: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: ApiTokenScope[];
  /** When the grant it becomes ends; null for never. */
  grantExpiresAt: string | null;
  expiresAt: string;
}

/** The OAuth server's own rows; the grants themselves are API tokens. */
export interface OAuthRepo {
  createClient(client: StoredOAuthClient): Promise<void>;
  getClient(id: string): Promise<StoredOAuthClient | null>;
  touchClient(id: string, lastUsedAt: string): Promise<void>;
  /** Clients registered before `createdBefore` and never given a grant. */
  deleteUnusedClients(createdBefore: string): Promise<number>;
  createCode(code: StoredOAuthCode): Promise<void>;
  /** Takes a code out: a second redemption finds nothing. An expired code is
   * taken out too, and comes back null. */
  redeemCode(codeHash: string, nowIso: string): Promise<StoredOAuthCode | null>;
  deleteExpiredCodes(nowIso: string): Promise<number>;
}
