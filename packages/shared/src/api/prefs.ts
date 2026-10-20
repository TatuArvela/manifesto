/**
 * The preferences of an account, as its clients sent them last: a flat object
 * of JSON values, with the names of the client as keys. The server stores it,
 * and never reads a value. Each client parses what it gets, as it parses a blob
 * that a person edited. It is sparse: a key that no client sent is absent.
 */
export type AccountPrefs = Record<string, unknown>;

/** The maximum size of `AccountPrefs`, as JSON. */
export const MAX_ACCOUNT_PREFS_BYTES = 16_384;

/**
 * The maximum size of the sealed preferences on the server, as JSON. Each value
 * is a third larger than what it seals, and has a nonce and a tag.
 */
export const MAX_SEALED_ACCOUNT_PREFS_BYTES = 32_768;

/** `GET /api/v1/auth/me/prefs`, and the answer to a `PATCH`. */
export interface AccountPrefsResponse {
  prefs: AccountPrefs;
}

/** `PATCH /api/v1/auth/me/prefs`: the keys to set. `null` removes one. */
export interface AccountPrefsUpdate {
  prefs: AccountPrefs;
}
