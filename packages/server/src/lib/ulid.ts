import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

/** A short lowercase suffix from a fresh ULID — useful for collision-resolving
 * tags (e.g. unique usernames) where 26 chars would be ugly. */
export function newShortSuffix(): string {
  return ulid().slice(-6).toLowerCase();
}
