/**
 * The two keys that a person keeps: the secret key, which decrypts the notes,
 * and the recovery key, which brings the account back when all else is lost
 * (`docs/specification/features/encryption.md`). Both are random, made here,
 * and in a shape that you can type: seven groups of four letters and digits
 * behind a prefix that tells one from the other.
 *
 * 28 characters from an alphabet of 31 is approximately 138 bits, which nobody
 * can guess. Thus, the wrap that each derives needs no slow hash to protect it.
 */

export type UserKeyKind = "secret" | "recovery";

/**
 * No `0`, `1`, `I`, `L` or `O`. None of them stays correct when read aloud or
 * copied from paper.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const GROUPS = 7;
const GROUP_LENGTH = 4;
const LENGTH = GROUPS * GROUP_LENGTH;

const PREFIXES: Record<UserKeyKind, string> = {
  secret: "SK",
  recovery: "RK",
};

function format(kind: UserKeyKind, characters: string): string {
  const groups: string[] = [];
  for (let i = 0; i < LENGTH; i += GROUP_LENGTH) {
    groups.push(characters.slice(i, i + GROUP_LENGTH));
  }
  return `${PREFIXES[kind]}-${groups.join("-")}`;
}

/** A new key of `kind`, with each character equally probable. */
export function newUserKey(kind: UserKeyKind): string {
  // The code folds a byte onto the alphabet only when it is under the largest
  // multiple of its length. If not, the first eight characters would occur a
  // little more frequently than the others.
  const limit = 256 - (256 % ALPHABET.length);
  let characters = "";
  while (characters.length < LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(LENGTH * 2));
    for (const byte of bytes) {
      if (byte >= limit || characters.length === LENGTH) continue;
      characters += ALPHABET[byte % ALPHABET.length];
    }
  }
  return format(kind, characters);
}

/** What was typed, with its case, spaces and dashes removed. */
function bare(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Which kind of key `input` says that it is by its prefix, or null when it has
 * none. Used to tell a person that they typed the other key.
 */
export function userKeyKindOf(input: string): UserKeyKind | null {
  const text = bare(input);
  if (text.length !== LENGTH + 2) return null;
  for (const kind of ["secret", "recovery"] as const) {
    if (text.startsWith(PREFIXES[kind])) return kind;
  }
  return null;
}

/**
 * A key of `kind` as typed, pasted or scanned, in the one form from which all
 * is derived, or null when it cannot be one: whatever its case, spaces or
 * dashes, with or without its prefix.
 */
export function parseUserKey(input: string, kind: UserKeyKind): string | null {
  let text = bare(input);
  if (text.length === LENGTH + 2) {
    if (!text.startsWith(PREFIXES[kind])) return null;
    text = text.slice(2);
  }
  if (text.length !== LENGTH) return null;
  for (const character of text) {
    if (!ALPHABET.includes(character)) return null;
  }
  return format(kind, text);
}
