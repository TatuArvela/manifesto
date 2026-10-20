import type { ApiToken, ApiTokenScope } from "@manifesto/shared";

// API tokens, and the OAuth server that gives them to assistants.

export interface StoredApiToken extends ApiToken {
  userId: string;
  /**
   * When the current access token of an OAuth grant expires. Null for a manual
   * token, whose secret lasts as long as the token.
   */
  accessExpiresAt: string | null;
  /**
   * Its keys, wrapped under a key derived from its secret. Null for a token
   * that reaches no note. Never listed.
   */
  wrappedKeys: string | null;
  /**
   * For the grant of an assistant that carries keys: the same keys wrapped
   * under its refresh token, which makes the copy of the next access token.
   * Never listed.
   */
  refreshWrappedKeys: string | null;
}

/**
 * The secrets of an OAuth grant, replaced together at each refresh. The copies
 * of its keys under the old tokens go with them.
 */
export interface OAuthGrantSecrets {
  tokenHash: string;
  refreshHash: string;
  accessExpiresAt: string;
  wrappedKeys: string | null;
  refreshWrappedKeys: string | null;
}

/**
 * Personal API tokens, with the SHA-256 of the secret as the key. The OAuth
 * grant of an assistant is one of them (`oauthClientId` set), with a refresh
 * token next to the access token.
 */
export interface ApiTokensRepo {
  create(
    input: Omit<StoredApiToken, "wrappedKeys" | "refreshWrappedKeys"> & {
      tokenHash: string;
      refreshHash?: string;
      /** Not given for a token that carries no key. */
      wrappedKeys?: string | null;
      refreshWrappedKeys?: string | null;
    },
  ): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredApiToken | null>;
  /** The grant whose current refresh token this is. */
  findByRefreshHash(refreshHash: string): Promise<StoredApiToken | null>;
  /** The grant whose refresh token this was until its last refresh. */
  findByPreviousRefreshHash(
    refreshHash: string,
  ): Promise<StoredApiToken | null>;
  /**
   * Replace the secrets of a grant, if `refreshHash` is still its refresh
   * token. One statement. Thus, of two refreshes with the same token, only one
   * wins. The old refresh token is kept as the previous one.
   */
  rotate(refreshHash: string, next: OAuthGrantSecrets): Promise<boolean>;
  listByUser(userId: string): Promise<ApiToken[]>;
  /**
   * The token of the user. Thus, one user cannot revoke the token of a
   * different user. Returns the hash of the deleted token, which names the
   * sockets that it opened, or null.
   */
  delete(id: string, userId: string): Promise<string | null>;
  deleteByUser(userId: string): Promise<number>;
  touch(id: string, lastUsedAt: string): Promise<void>;
  deleteExpired(nowIso: string): Promise<number>;
}

/** An OAuth client that registered itself (`POST /api/v1/oauth/register`). */
export interface StoredOAuthClient {
  id: string;
  name: string;
  redirectUris: string[];
  createdAt: string;
  /** When it last got a grant. Null until the first. */
  lastUsedAt: string | null;
}

/** What a consent gives: good one time, until `expiresAt`. */
export interface StoredOAuthCode {
  codeHash: string;
  clientId: string;
  /**
   * Kept for the name of the grant, because the server does not store a client
   * that identifies itself by its metadata document.
   */
  clientName: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: ApiTokenScope[];
  /** When the grant that it becomes ends. Null for never. */
  grantExpiresAt: string | null;
  expiresAt: string;
  /**
   * The keys of the future grant, wrapped under the code. Null for a consent
   * that gave none.
   */
  wrappedKeys: string | null;
}

/** The own rows of the OAuth server. The grants themselves are API tokens. */
export interface OAuthRepo {
  createClient(client: StoredOAuthClient): Promise<void>;
  getClient(id: string): Promise<StoredOAuthClient | null>;
  touchClient(id: string, lastUsedAt: string): Promise<void>;
  /** Clients registered before `createdBefore` that never got a grant. */
  deleteUnusedClients(createdBefore: string): Promise<number>;
  createCode(code: StoredOAuthCode): Promise<void>;
  /**
   * Takes a code out. A second redemption finds nothing. An expired code is
   * also taken out, and comes back null.
   */
  redeemCode(codeHash: string, nowIso: string): Promise<StoredOAuthCode | null>;
  deleteExpiredCodes(nowIso: string): Promise<number>;
}
