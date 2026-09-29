/**
 * An account's preferences, as its clients last sent them: a flat object of
 * JSON values, keyed by the client's own names. The server stores it and
 * never reads a value; each client parses what it gets as it would a
 * hand-edited blob. Sparse: a key no client has sent is absent.
 */
export type AccountPrefs = Record<string, unknown>;

/** How large `AccountPrefs` may grow, as JSON. */
export const MAX_ACCOUNT_PREFS_BYTES = 16_384;

/** `GET /api/auth/me/prefs`, and the answer to a `PATCH`. */
export interface AccountPrefsResponse {
  prefs: AccountPrefs;
}

/** `PATCH /api/auth/me/prefs`: the keys to set; `null` removes one. */
export interface AccountPrefsUpdate {
  prefs: AccountPrefs;
}
