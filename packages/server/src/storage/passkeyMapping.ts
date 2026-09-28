import type { Passkey } from "@manifesto/shared";
import type { StoredPasskey } from "./types.js";

export interface PasskeyRow {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  /** A string from Postgres, whose BIGINT the driver does not narrow. */
  counter: number | string;
  /** A JSON array of transport names. */
  transports: string;
  rp_id: string;
  name: string;
  synced: number | boolean;
  created_at: string;
  last_used_at: string | null;
}

export const PASSKEY_COLUMNS =
  "id, user_id, credential_id, public_key, counter, transports, rp_id, name, synced, created_at, last_used_at";

function parseTransports(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string")
      : [];
  } catch {
    return [];
  }
}

export function rowToPasskey(row: PasskeyRow): StoredPasskey {
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: Number(row.counter),
    transports: parseTransports(row.transports),
    rpId: row.rp_id,
    name: row.name,
    synced: row.synced === true || row.synced === 1,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** A passkey as its owner sees it listed. */
export function listedPasskey(passkey: StoredPasskey): Passkey {
  return {
    id: passkey.id,
    name: passkey.name,
    synced: passkey.synced,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
  };
}
