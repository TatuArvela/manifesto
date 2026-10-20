import { randomInt } from "node:crypto";

/**
 * Lowercase letters and digits, without the characters that look the same when
 * you read them on a screen or say them (0 and o, 1 and l and i).
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const GROUPS = 4;
const GROUP_LENGTH = 4;

/**
 * A password that an admin gives to a person. The person signs in with it one
 * time, and must replace it. Sixteen characters from 31 is approximately 79
 * bits. The dashes only help the reader to keep their position.
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
