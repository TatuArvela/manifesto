import { ulid } from "ulid";

export function newId(): string {
  return ulid();
}

/**
 * A short lowercase suffix from a new ULID. It is useful for tags that resolve
 * collisions (for example, unique usernames), where 26 characters would look
 * bad.
 */
export function newShortSuffix(): string {
  return ulid().slice(-6).toLowerCase();
}
