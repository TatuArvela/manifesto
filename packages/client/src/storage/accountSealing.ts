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
 * What the `Sealer` seals under the account's keys alone, about no note: the
 * keys a token carries, the public keys remembered of other accounts, and
 * the preferences. Apart from `sealing.ts` so that file stays about notes.
 */

/** An account's public keys as another account remembers having seen them. */
export interface SeenKeys {
  version: number;
  exchange: string;
  signing: string;
}

/** What a token that carries keys is made from. */
export interface TokenKeys {
  /** The version of the account key. */
  version: number;
  /** Derives, and cannot be read out. */
  accountKey: CryptoKey;
}

/** A new token's secret, and what the server is sent of it. */
export interface NewToken {
  secret: string;
  fields: { tokenHash: string; prefix: string; wrappedKeys: string };
}

/**
 * A new token that carries keys: its secret, which stays on this side, and
 * what the server is sent of it. The notes key and the personal key (or, for
 * a calendar feed, the reminder key alone) are derived from the account key
 * as bytes for the one wrap and wiped; the account key itself is never among
 * them, so a token opens no private key and accepts no invitation.
 */
export async function newKeyedToken(
  keys: TokenKeys,
  prefix: string,
  carries: "notes" | "reminders",
): Promise<NewToken> {
  const secret = newTokenSecret(prefix);
  const fields = async (wrappedKeys: string) => ({
    tokenHash: await tokenHashOf(secret),
    // The prefix and six characters, which is what a list shows.
    prefix: secret.slice(0, prefix.length + 6),
    wrappedKeys,
  });
  if (carries === "reminders") {
    // A calendar feed's address: the reminder key and nothing else.
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

/** Someone's public keys as this account remembers them, sealed under its
 * own key and bound to whose they are. */
export function sealSeenKeys(
  account: AccountSealKeys,
  peerId: string,
  keys: SeenKeys,
): Promise<string> {
  return sealPref(account, `seen/${peerId}`, keys);
}

/** The remembered keys that open, by account. One that does not open, or is
 * not a pair of keys, is left out, and its account is met as new. */
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

/** The preferences to send, each sealed; `null` removes one and stays. */
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

/** The preferences that open; one that does not is left out. */
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
