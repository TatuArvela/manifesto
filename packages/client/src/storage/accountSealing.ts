import {
  type AccountSealKeys,
  deriveBytes,
  newTokenSecret,
  openPref,
  type SealedAccountPrefs,
  sealPref,
  tokenHashOf,
  wipe,
  wrapFeedKey,
  wrapTokenKeys,
} from "@manifesto/shared";

/**
 * What the `Sealer` seals only under the keys of the account, about no note:
 * the keys that a token carries, the remembered public keys of other accounts,
 * and the preferences. Separate from `sealing.ts`. Thus, that file stays about
 * notes.
 */

/** The public keys of an account as a different account remembers them. */
export interface SeenKeys {
  version: number;
  exchange: string;
  signing: string;
}

/** What a token that carries keys is made from. */
export interface TokenKeys {
  /** The version of the account key. */
  version: number;
  /** It derives, and cannot be read out. */
  accountKey: CryptoKey;
}

/** The secret of a new token, and what the server gets of it. */
export interface NewToken {
  secret: string;
  fields: { tokenHash: string; prefix: string; wrappedKeys: string };
}

/**
 * A new token that carries keys: its secret, which stays on this side, and what
 * the server gets of it. The notes key and the personal key (or, for a calendar
 * feed, only the reminder key) are derived from the account key as bytes for
 * the one wrap, and then wiped. The account key itself is never among them.
 * Thus, a token opens no private key, and accepts no invitation.
 */
export async function newKeyedToken(
  keys: TokenKeys,
  prefix: string,
  carries: "notes" | "reminders",
): Promise<NewToken> {
  const secret = newTokenSecret(prefix);
  const fields = async (wrappedKeys: string) => ({
    tokenHash: await tokenHashOf(secret),
    // The prefix and six characters, which a list shows.
    prefix: secret.slice(0, prefix.length + 6),
    wrappedKeys,
  });
  if (carries === "reminders") {
    // The address of a calendar feed: the reminder key and nothing else.
    const reminders = await deriveBytes(keys.accountKey, "account/reminder");
    try {
      return {
        secret,
        fields: await fields(
          await wrapFeedKey(secret, { version: keys.version, reminders }),
        ),
      };
    } finally {
      wipe(reminders);
    }
  }
  const notes = await deriveBytes(keys.accountKey, "account/notes");
  const personal = await deriveBytes(keys.accountKey, "account/personal");
  try {
    return {
      secret,
      fields: await fields(
        await wrapTokenKeys(secret, { version: keys.version, notes, personal }),
      ),
    };
  } finally {
    wipe(notes);
    wipe(personal);
  }
}

/**
 * The public keys of a person as this account remembers them, sealed under its
 * own key and bound to their owner.
 */
export function sealSeenKeys(
  account: AccountSealKeys,
  peerId: string,
  keys: SeenKeys,
): Promise<string> {
  return sealPref(account, `seen/${peerId}`, keys);
}

/**
 * The remembered keys that open, by account. The code does not include a key
 * that does not open, or that is not a pair of keys. Its account then looks
 * new.
 */
export async function openSeenKeys(
  account: AccountSealKeys,
  sealed: Record<string, string>,
): Promise<Map<string, SeenKeys>> {
  const out = new Map<string, SeenKeys>();
  for (const [peerId, value] of Object.entries(sealed)) {
    const opened = (await openPref(account, `seen/${peerId}`, value)) as
      | Partial<SeenKeys>
      | undefined;
    if (
      opened &&
      typeof opened === "object" &&
      typeof opened.exchange === "string" &&
      typeof opened.signing === "string" &&
      typeof opened.version === "number"
    ) {
      out.set(peerId, {
        version: opened.version,
        exchange: opened.exchange,
        signing: opened.signing,
      });
    }
  }
  return out;
}

/** The preferences to send, each sealed. `null` removes one and stays. */
export async function sealPrefs(
  account: AccountSealKeys,
  prefs: Record<string, unknown>,
): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const [name, value] of Object.entries(prefs)) {
    out[name] =
      value === null || value === undefined
        ? null
        : await sealPref(account, name, value);
  }
  return out;
}

/**
 * The preferences that open. The code does not include a preference that does
 * not open.
 */
export async function openPrefs(
  account: AccountSealKeys,
  sealed: SealedAccountPrefs,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(sealed)) {
    const opened = await openPref(account, name, value);
    if (opened !== undefined) out[name] = opened;
  }
  return out;
}
