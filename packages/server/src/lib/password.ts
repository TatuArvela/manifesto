import argon2 from "argon2";
import type { ServerConfig } from "../config.js";

export async function hashPassword(
  plaintext: string,
  cfg: Pick<
    ServerConfig,
    "argon2MemoryKib" | "argon2TimeCost" | "argon2Parallelism"
  >,
): Promise<string> {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: cfg.argon2MemoryKib,
    timeCost: cfg.argon2TimeCost,
    parallelism: cfg.argon2Parallelism,
  });
}

export async function verifyPassword(
  hash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
