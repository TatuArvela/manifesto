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

// Handing a note's key to someone on it, and taking one handed to this
// account (`shared/src/crypto/shareSeal.ts`): the account's private keys,
// and what is done with them. The `Sealer` holds the note keys and calls
// these with the one in question.

interface OwnPrivateKeys {
  exchange: CryptoKey;
  signing: CryptoKey;
}

/** The unlocked account's two private keys, opened the first time one is
 * needed. */
export class PrivateKeys {
  private opened: Promise<OwnPrivateKeys | null> | null = null;

  constructor(
    private readonly accountKey: CryptoKey,
    private readonly userId: string,
  ) {}

  /**
   * The account's two private keys, opened with the account key from what
   * the server holds wrapped (`load`). Null when they could not be read or
   * do not open; asked again the next time, then.
   */
  async get(
    load: () => Promise<AccountKeys | null>,
  ): Promise<OwnPrivateKeys | null> {
    this.opened ??= (async () => {
      // A failure is a null too, or it would be kept and answered to every
      // later caller until the account is unlocked again.
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
 * A note key this account holds wrapped (`wrapped`, at `version`), opened and
 * wrapped again to `recipient`'s public key, signed with `signing`. Null when
 * the account's copy does not open.
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
 * A key offered to this account, if its signature checks against
 * `signerKey` and it opens with the private exchange key (asked for only
 * once the signature has checked), and, given `words`, is the key of those
 * sealed fields. Then it is wrapped under this account's notes key too, to
 * store. Null for any other.
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
