import { randomInt } from "node:crypto";

/**
 * Lowercase letters and digits, less the ones that pass for each other when
 * read off a screen or said aloud (0 and o, 1 and l and i).
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * A password an admin hands to someone, who signs in with it once and is made
 * to replace it. Sixteen characters from 31 is about 79 bits, and the dashes
 * are only there to keep the reader's place.
 */
export function newTemporaryPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}
