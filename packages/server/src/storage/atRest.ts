import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

/**
 * The server key (`docs/specification/features/encryption.md`, "The server
 * key"): the key under which the server stores the few values that it must read
 * by itself. The words of a note are not among them, because the server has no
 * key for those. These are the values on which it acts when nobody is signed
 * in: the time of a reminder, the signing secret of a webhook, the secret of an
 * authenticator, the key that signs push messages, and the keys of each push
 * subscription.
 *
 * AES-256-GCM, a random nonce for each value, and the purpose of the column as
 * the associated data. Thus, a value moved to a different column does not open.
 * Each value names its key. This lets you replace the key: the previous key
 * stays readable until `moveToCurrentKey` wrote all values again under the new
 * key.
 *
 * The key is never in the database. If you lose it, you lose these values,
 * which you can all make again, and no note.
 */

const PREFIX = "s1.";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface ServerKeys {
  current: Buffer;
  /** The previous key, while values under it still move. */
  previous: Buffer | null;
}

export interface AtRest {
  /** `text` under the current key. */
  seal(text: string, purpose: string): string;
  /**
   * What `stored` contains. A value from before the server had a key is not
   * sealed, and comes back as it is. Null for a sealed value that opens with
   * neither key: its key is gone.
   */
  open(stored: string, purpose: string): string | null;
  /**
   * `stored` under the current key, or null when it already is, or cannot open.
   */
  moved(stored: string, purpose: string): string | null;
  /** If `stored` is under the key before the current key. */
  underPrevious(stored: string): boolean;
}

/** A key as an operator gives it: 32 bytes, in base64 or in hex. */
export function parseServerKey(text: string): Buffer | null {
  const trimmed = text.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(trimmed)) return null;
  const key = Buffer.from(trimmed, "base64");
  return key.length === 32 ? key : null;
}

/** A new key, as it is written to a key file. */
export function newServerKey(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * What a value says about its key: not the key, and not sufficient of a hash to
 * test a guess against anything other than a different 256-bit key.
 */
function keyId(key: Buffer): string {
  return createHash("sha256")
    .update("manifesto/v1/server-key-id\n")
    .update(key)
    .digest("hex")
    .slice(0, 8);
}

export function createAtRest(keys: ServerKeys): AtRest {
  const current = { id: keyId(keys.current), key: keys.current };
  const previous = keys.previous
    ? { id: keyId(keys.previous), key: keys.previous }
    : null;

  const idOf = (stored: string): string | null => {
    if (!stored.startsWith(PREFIX)) return null;
    const dot = stored.indexOf(".", PREFIX.length);
    return dot < 0 ? null : stored.slice(PREFIX.length, dot);
  };

  function seal(text: string, purpose: string): string {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv("aes-256-gcm", current.key, nonce);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const body = Buffer.concat([
      nonce,
      cipher.update(text, "utf8"),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return `${PREFIX}${current.id}.${body.toString("base64url")}`;
  }

  function open(stored: string, purpose: string): string | null {
    const id = idOf(stored);
    // Written before the server had a key.
    if (id === null) return stored;
    const held =
      id === current.id ? current : id === previous?.id ? previous : null;
    if (!held) return null;
    const body = Buffer.from(
      stored.slice(PREFIX.length + id.length + 1),
      "base64url",
    );
    if (body.length < NONCE_BYTES + TAG_BYTES) return null;
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        held.key,
        body.subarray(0, NONCE_BYTES),
      );
      decipher.setAAD(Buffer.from(purpose, "utf8"));
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      return Buffer.concat([
        decipher.update(body.subarray(NONCE_BYTES, body.length - TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      return null;
    }
  }

  return {
    seal,
    open,
    moved(stored, purpose) {
      if (idOf(stored) === current.id) return null;
      const plain = open(stored, purpose);
      return plain === null ? null : seal(plain, purpose);
    },
    underPrevious: (stored) =>
      previous !== null && idOf(stored) === previous.id,
  };
}

/**
 * No key: values are stored as they are. A storage driver that you build
 * manually (a storage test) runs with this. A server always sets a real key.
 */
const UNSEALED: AtRest = {
  seal: (text) => text,
  open: (stored) => stored,
  moved: () => null,
  underPrevious: () => false,
};

let active: AtRest = UNSEALED;

/**
 * Sets the key with which this process stores. One for the process, because
 * there is one server key. `createStorage` calls it before it builds a driver.
 */
export function useAtRest(next: AtRest | null): void {
  active = next ?? UNSEALED;
}

/**
 * The server key of the process, as the row mappings and the repositories use
 * it.
 */
export const atRest: AtRest = {
  seal: (text, purpose) => active.seal(text, purpose),
  open: (stored, purpose) => active.open(stored, purpose),
  moved: (stored, purpose) => active.moved(stored, purpose),
  underPrevious: (stored) => active.underPrevious(stored),
};

/** How each column under the server key is sealed. */
export const AT_REST = {
  reminder: "reminder",
  webhookSecret: "webhook.secret",
  totpSecret: "totp.secret",
  serverSecret: "server-secret",
  pushKey: "push.key",
} as const;

/**
 * Each column under the server key. Add a new one here, so that a key
 * replacement also moves it. `keys` is the primary key of the row.
 */
export const AT_REST_COLUMNS: readonly {
  table: string;
  keys: readonly string[];
  column: string;
  purpose: string;
}[] = [
  {
    table: "notes",
    keys: ["id"],
    column: "reminder",
    purpose: AT_REST.reminder,
  },
  {
    table: "note_shares",
    keys: ["note_id", "user_id"],
    column: "reminder",
    purpose: AT_REST.reminder,
  },
  {
    table: "webhooks",
    keys: ["id"],
    column: "secret",
    purpose: AT_REST.webhookSecret,
  },
  {
    table: "user_totp",
    keys: ["user_id"],
    column: "secret",
    purpose: AT_REST.totpSecret,
  },
  {
    table: "server_secrets",
    keys: ["name"],
    column: "value",
    purpose: AT_REST.serverSecret,
  },
  {
    table: "push_subscriptions",
    keys: ["id"],
    column: "p256dh",
    purpose: AT_REST.pushKey,
  },
  {
    table: "push_subscriptions",
    keys: ["id"],
    column: "auth",
    purpose: AT_REST.pushKey,
  },
];
