import { base64urlToBytes, bytesToBase64url, utf8, wipe } from "./bytes.ts";
import type { AccountSealKeys } from "./noteKey.ts";
import {
  associatedData,
  derivable,
  deriveKey,
  seal,
  sealingKey,
  unsealText,
} from "./seal.ts";

/**
 * A token that carries a key (`docs/specification/features/encryption.md`,
 * "Tokens that carry a key").
 *
 * A script cannot run the app. Thus, it cannot open a note. For this reason,
 * the app makes the secret of the token itself. It gives the server the hash of
 * the token, and the keys that the token needs, wrapped under a key derived
 * from that secret. The server can open them only while a request has the
 * token, and keeps nothing after that. The wrapping key has a different
 * derivation than the hash that the server stores. The hash is a plain SHA-256
 * of the token, and must not also be the key.
 *
 * An API or MCP token contains the notes key and the personal key, never the
 * account key. Thus, it opens no private key, accepts no invitation, and wraps
 * nothing for a different token.
 */

/** The keys of a token, as bytes, before they are wrapped. */
export interface TokenKeyMaterial {
  /** The version of the account key from which they come. */
  version: number;
  notes: Uint8Array<ArrayBuffer>;
  personal: Uint8Array<ArrayBuffer>;
}

/** The maximum length of the wrapped keys of a token. */
export const MAX_TOKEN_KEYS_LENGTH = 512;

const DATA = associatedData({ id: "", field: "token/keys", version: 1 });

async function wrapKeyOf(secret: string): Promise<CryptoKey> {
  return deriveKey(await derivable(utf8(secret)), "token/wrap");
}

/** The hash by which a server finds a token: SHA-256 of the secret, in hex. */
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

/** The keys of a token, wrapped under a key derived from its secret. */
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
 * The keys of a presented token, as bytes. This is for the one place that must
 * wrap them again under a different secret: the exchange that changes the code
 * or the refresh token of an assistant into its next tokens. Null when
 * `wrapped` does not open with this secret. The caller wipes them.
 */
export async function openTokenKeyMaterial(
  secret: string,
  wrapped: string,
): Promise<TokenKeyMaterial | null> {
  const text = await unsealText(await wrapKeyOf(secret), wrapped, DATA);
  if (text === null) return null;
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
    return {
      version: parsed.version,
      notes: base64urlToBytes(parsed.notes),
      personal: base64urlToBytes(parsed.personal),
    };
  } catch {
    return null;
  }
}

/**
 * The keys of a presented token, ready to open and seal the notes of `userId`.
 * Null when `wrapped` does not open with this secret. The keys exist only for
 * the request that asked, and are never stored.
 */
export async function unwrapTokenKeys(
  secret: string,
  wrapped: string,
  userId: string,
): Promise<AccountSealKeys | null> {
  const material = await openTokenKeyMaterial(secret, wrapped);
  if (!material) return null;
  try {
    return {
      userId,
      version: material.version,
      notes: await sealingKey(material.notes),
      personal: await sealingKey(material.personal),
    };
  } catch {
    return null;
  } finally {
    wipe(material.notes);
    wipe(material.personal);
  }
}

const FEED_DATA = associatedData({
  id: "",
  field: "token/feed-key",
  version: 1,
});

/**
 * The key that the address of a calendar feed contains: only the reminder key
 * of the account, wrapped under a key derived from the secret of the address. A
 * feed address is the weakest of the secrets (the calendar service has it, and
 * each proxy on the way). Thus, it opens the notes that have a reminder, and no
 * other notes.
 */
export async function wrapFeedKey(
  secret: string,
  keys: { version: number; reminders: Uint8Array<ArrayBuffer> },
): Promise<string> {
  return seal(
    await wrapKeyOf(secret),
    utf8(
      JSON.stringify({
        version: keys.version,
        reminders: bytesToBase64url(keys.reminders),
      }),
    ),
    FEED_DATA,
  );
}

/**
 * The reminder key of a presented feed address. Null when `wrapped` does not
 * open with this secret. It exists only for the request that asked.
 */
export async function unwrapFeedKey(
  secret: string,
  wrapped: string,
): Promise<{ version: number; reminders: CryptoKey } | null> {
  const text = await unsealText(await wrapKeyOf(secret), wrapped, FEED_DATA);
  if (text === null) return null;
  let reminders: Uint8Array<ArrayBuffer> | undefined;
  try {
    const parsed = JSON.parse(text) as {
      version?: unknown;
      reminders?: unknown;
    };
    if (
      typeof parsed.version !== "number" ||
      typeof parsed.reminders !== "string"
    ) {
      return null;
    }
    reminders = base64urlToBytes(parsed.reminders);
    return { version: parsed.version, reminders: await sealingKey(reminders) };
  } catch {
    return null;
  } finally {
    if (reminders) wipe(reminders);
  }
}
