import {
  type AccountKeys,
  type AccountSealKeys,
  type NoteSealKey,
  noteSealKey,
  type OfferedKey,
  offerNoteKey,
  openOfferedKey,
  opensSharedFields,
  type SharedSealed,
  unwrapNoteKey,
  verifyOfferedKey,
  wipe,
  wrapNoteKey,
} from "@manifesto/shared";
import { openPrivateKey } from "#/utils/keyMaterial.ts";

// The supply of the key of a note to a person on it, and the acceptance of a
// key given to this account (`shared/src/crypto/shareSeal.ts`): the private
// keys of the account, and what is done with them. The `Sealer` has the note
// keys, and calls these with the applicable key.

interface OwnPrivateKeys {
  exchange: CryptoKey;
  signing: CryptoKey;
}

/**
 * The two private keys of the unlocked account, opened the first time that code
 * needs one.
 */
export class PrivateKeys {
  private opened: Promise<OwnPrivateKeys | null> | null = null;

  constructor(
    private readonly accountKey: CryptoKey,
    private readonly userId: string,
  ) {}

  /**
   * The two private keys of the account, opened with the account key from the
   * wrapped copy that the server has (`load`). Null when the code could not
   * read them, or when they do not open. Then the code asks again the next
   * time.
   */
  async get(
    load: () => Promise<AccountKeys | null>,
  ): Promise<OwnPrivateKeys | null> {
    this.opened ??= (async () => {
      // A failure is also a null. If not, it would be kept and given as the
      // answer to each later caller until the account is unlocked again.
      try {
        return await this.open(load);
      } catch (err) {
        console.warn("Failed to open this account's private keys:", err);
        return null;
      }
    })();
    const opened = await this.opened;
    if (!opened) this.opened = null;
    return opened;
  }

  private async open(load: () => Promise<AccountKeys | null>) {
    const held = await load();
    if (!held) return null;
    const { accountKey, userId } = this;
    const exchange = await openPrivateKey(accountKey, userId, held, "exchange");
    const signing = await openPrivateKey(accountKey, userId, held, "signing");
    return exchange && signing ? { exchange, signing } : null;
  }
}

/**
 * A note key that this account has wrapped (`wrapped`, at `version`), opened
 * and wrapped again to the public key of `recipient`, signed with `signing`.
 * Null when the copy of the account does not open.
 */
export async function offerHeldKey(
  account: AccountSealKeys,
  signing: CryptoKey,
  noteId: string,
  held: { version: number; wrapped: string },
  recipient: { userId: string; exchange: string },
): Promise<OfferedKey | null> {
  const raw = await unwrapNoteKey(account, noteId, held.version, held.wrapped);
  if (!raw) return null;
  try {
    return await offerNoteKey(
      { noteId, recipientId: recipient.userId },
      held.version,
      raw,
      recipient.exchange,
      { userId: account.userId, signing },
    );
  } finally {
    wipe(raw);
  }
}

/**
 * A key offered to this account, if its signature passes the check against
 * `signerKey`, and it opens with the private exchange key (requested only after
 * the signature passed the check), and, given `words`, it is the key of those
 * sealed fields. Then it is also wrapped under the notes key of this account,
 * to store. Null for all other keys.
 */
export async function takeOfferedKey(
  account: AccountSealKeys,
  noteId: string,
  offered: OfferedKey,
  signerKey: string,
  exchange: () => Promise<CryptoKey | null>,
  words?: Partial<SharedSealed>,
): Promise<{ key: NoteSealKey; wrapped: string } | null> {
  const context = { noteId, recipientId: account.userId };
  if (!(await verifyOfferedKey(context, offered, signerKey))) return null;
  const own = await exchange();
  if (!own) return null;
  const raw = await openOfferedKey(context, offered, own);
  if (!raw) return null;
  try {
    const key = await noteSealKey(raw, offered.keyVersion);
    if (words && !(await opensSharedFields(key, noteId, words))) return null;
    const wrapped = await wrapNoteKey(account, noteId, offered.keyVersion, raw);
    return { key, wrapped };
  } finally {
    wipe(raw);
  }
}
