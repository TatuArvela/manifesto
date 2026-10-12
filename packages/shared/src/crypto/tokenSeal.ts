import {
  base64urlToBytes,
  bytesToBase64url,
  fromUtf8,
  utf8,
  wipe,
} from "./bytes.js";
import type { AccountSealKeys } from "./noteSeal.js";
import {
  associatedData,
  derivable,
  deriveKey,
  seal,
  sealingKey,
  unseal,
} from "./seal.js";

/**
 * A token that carries a key
 * (`docs/specification/features/encryption.md`, "Tokens that carry a key").
 *
 * A script cannot run the app, so it cannot open a note. The app therefore
 * makes the token's secret itself and hands the server, beside the token's
 * hash, the keys the token needs wrapped under a key derived from that
 * secret. The server can open them only while a request presents the token,
 * and keeps nothing afterwards. The wrapping key is derived apart from the
 * hash the server stores, which is a plain SHA-256 of the token and must not
 * be the key as well.
 *
 * An API or MCP token carries the notes key and the personal key, never the
 * account key: it opens no private key, accepts no invitation and wraps
 * nothing for another token.
 */

/** The keys a token carries, as bytes, before they are wrapped. */
export interface TokenKeyMaterial {
  /** The version of the account key they come from. */
  version: number;
  notes: Uint8Array<ArrayBuffer>;
  personal: Uint8Array<ArrayBuffer>;
}

/** The longest a token's wrapped keys may be. */
export const MAX_TOKEN_KEYS_LENGTH = 512;

const DATA = associatedData({ id: "", field: "token/keys", version: 1 });

async function wrapKeyOf(secret: string): Promise<CryptoKey> {
  return deriveKey(await derivable(utf8(secret)), "token/wrap");
}

/** The hash a server finds a token by: SHA-256 of the secret, in hex. */
export async function tokenHashOf(secret: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", utf8(secret)),
  );
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A new token secret: `prefix` and 256 random bits. */
export function newTokenSecret(prefix: string): string {
  return `${prefix}${bytesToBase64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/** The keys a token carries, wrapped under a key derived from its secret. */
export async function wrapTokenKeys(
  secret: string,
  keys: TokenKeyMaterial,
): Promise<string> {
  return seal(
    await wrapKeyOf(secret),
    utf8(
      JSON.stringify({
        version: keys.version,
        notes: bytesToBase64url(keys.notes),
        personal: bytesToBase64url(keys.personal),
      }),
    ),
    DATA,
  );
}

/**
 * The keys a presented token carries, ready to open and seal `userId`'s
 * notes with. Null when `wrapped` does not open with this secret. The keys
 * live for the request that asked and are never stored.
 */
export async function unwrapTokenKeys(
  secret: string,
  wrapped: string,
  userId: string,
): Promise<AccountSealKeys | null> {
  const bytes = await unseal(await wrapKeyOf(secret), wrapped, DATA);
  const text = bytes ? fromUtf8(bytes) : null;
  if (text === null) return null;
  let notes: Uint8Array<ArrayBuffer> | undefined;
  let personal: Uint8Array<ArrayBuffer> | undefined;
  try {
    const parsed = JSON.parse(text) as {
      version?: unknown;
      notes?: unknown;
      personal?: unknown;
    };
    if (
      typeof parsed.version !== "number" ||
      typeof parsed.notes !== "string" ||
      typeof parsed.personal !== "string"
    ) {
      return null;
    }
    notes = base64urlToBytes(parsed.notes);
    personal = base64urlToBytes(parsed.personal);
    return {
      userId,
      version: parsed.version,
      notes: await sealingKey(notes),
      personal: await sealingKey(personal),
    };
  } catch {
    return null;
  } finally {
    if (notes) wipe(notes);
    if (personal) wipe(personal);
  }
}
