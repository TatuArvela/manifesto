/**
 * The two keys a person holds: the secret key, which decrypts the notes, and
 * the recovery key, which brings the account back when everything else is
 * lost (`docs/specification/features/encryption.md`). Both are random, made
 * here, and shaped to be typed: seven groups of four letters and digits
 * behind a prefix that tells one from the other.
 *
 * 28 characters from an alphabet of 31 is about 138 bits, which nobody
 * guesses, so the wrap each derives needs no slow hash to protect it.
 */

export type UserKeyKind = "secret" | "recovery";

/** No `0`, `1`, `I`, `L` or `O`: none of them survives being read aloud or
 * copied from paper. */
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

/** A new key of `kind`, every character equally likely. */
export function newUserKey(kind: UserKeyKind): string {
  // A byte is folded onto the alphabet only when it falls under the largest
  // multiple of its length, or the first eight characters would come up a
  // little more often than the rest.
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

/** What was typed with its case, spaces and dashes taken out. */
function bare(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Which kind of key `input` says it is by its prefix, or null when it has
 * none: for telling someone they typed the other key.
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
 * A key of `kind` as typed, pasted or scanned, in the one form everything is
 * derived from, or null when it cannot be one: however it was cased, spaced
 * or dashed, with or without its prefix.
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
