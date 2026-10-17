import type { AccountPublicKeys } from "#/api/keys.js";
import { base64urlToBytes, bytesToBase64url, utf8, wipe } from "./bytes.js";
import { associatedData, derivable, deriveKey, seal, unseal } from "./seal.js";

/**
 * Handing a note key to another account
 * (`docs/specification/features/encryption.md`, "Sharing").
 *
 * The key is wrapped to the recipient's public key: an ephemeral ECDH key is
 * made for the one wrap, and the key both sides can derive from it seals the
 * note key. Wrapping to a public key takes no secret, and the server knows
 * every public key, so by itself a wrapped key says nothing about who made
 * it. The account that wraps therefore signs it, together with the note, the
 * version of the key and the account it is for, and the recipient uses no
 * wrapped key whose signature does not check against the key it remembers for
 * the signer.
 */

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const SIGNING = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNATURE = { name: "ECDSA", hash: "SHA-256" } as const;

/** A note key on its way to an account, as the server passes it on. */
export interface OfferedKey {
  /** Which note key this is. */
  keyVersion: number;
  /** The public half of the key made for this one wrap. */
  ephemeral: string;
  /** The note key, sealed under what the two public keys agree on. */
  wrapped: string;
  /** The account that wrapped and signed it. */
  signer: string;
  /** Its signature over the note, the version, the recipient and the wrap. */
  signature: string;
}

/** What a wrap is for, which the signature and the seal both bind it to. */
export interface OfferContext {
  noteId: string;
  recipientId: string;
}

/** The longest an offered key's parts may be, for the server to hold one to. */
export const OFFERED_KEY_MAX = { wrapped: 256, signature: 128 } as const;

function publicKey(
  raw: string,
  algorithm: typeof P256 | typeof SIGNING,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64urlToBytes(raw),
    algorithm,
    false,
    algorithm.name === "ECDSA" ? ["verify"] : [],
  );
}

async function wrapKeyFor(
  privateKey: CryptoKey,
  otherPublic: CryptoKey,
): Promise<CryptoKey> {
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: otherPublic },
      privateKey,
      256,
    ),
  );
  try {
    return await deriveKey(await derivable(shared), "share/wrap");
  } finally {
    wipe(shared);
  }
}

function offerData(context: OfferContext, keyVersion: number) {
  return associatedData({
    id: context.noteId,
    field: "offered-key",
    version: keyVersion,
    account: context.recipientId,
  });
}

function signedBytes(
  context: OfferContext,
  offer: Pick<OfferedKey, "keyVersion" | "ephemeral" | "wrapped" | "signer">,
): Uint8Array<ArrayBuffer> {
  return utf8(
    [
      "manifesto/v1/offered-key",
      context.noteId,
      String(offer.keyVersion),
      context.recipientId,
      offer.signer,
      offer.ephemeral,
      offer.wrapped,
    ].join("\n"),
  );
}

/**
 * Wraps a note key for `context.recipientId` and signs it as `signer`.
 * Throws when `recipientKey` is not a P-256 point.
 */
export async function offerNoteKey(
  context: OfferContext,
  keyVersion: number,
  noteKey: Uint8Array<ArrayBuffer>,
  recipientKey: string,
  signer: { userId: string; signing: CryptoKey },
): Promise<OfferedKey> {
  const pair = await crypto.subtle.generateKey(P256, false, ["deriveBits"]);
  const wrapKey = await wrapKeyFor(
    pair.privateKey,
    await publicKey(recipientKey, P256),
  );
  const unsigned = {
    keyVersion,
    ephemeral: bytesToBase64url(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    ),
    wrapped: await seal(wrapKey, noteKey, offerData(context, keyVersion)),
    signer: signer.userId,
  };
  return {
    ...unsigned,
    signature: bytesToBase64url(
      await crypto.subtle.sign(
        SIGNATURE,
        signer.signing,
        signedBytes(context, unsigned),
      ),
    ),
  };
}

/** Whether `offer` was signed for this note and recipient by the holder of
 * `signerKey`. False for anything malformed. */
export async function verifyOfferedKey(
  context: OfferContext,
  offer: OfferedKey,
  signerKey: string,
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      SIGNATURE,
      await publicKey(signerKey, SIGNING),
      base64urlToBytes(offer.signature),
      signedBytes(context, offer),
    );
  } catch {
    return false;
  }
}

/**
 * The note key an offer carries, opened with the recipient's private key.
 * Null when it does not open. The caller checks the signature first, and
 * wipes the bytes.
 */
export async function openOfferedKey(
  context: OfferContext,
  offer: OfferedKey,
  exchange: CryptoKey,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const wrapKey = await wrapKeyFor(
      exchange,
      await publicKey(offer.ephemeral, P256),
    );
    return await unseal(
      wrapKey,
      offer.wrapped,
      offerData(context, offer.keyVersion),
    );
  } catch {
    return null;
  }
}

/**
 * A short fingerprint of an account's two public keys, for two people to
 * compare: 96 bits of their SHA-256, as six groups of four.
 */
export async function keyFingerprint(keys: AccountPublicKeys): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      utf8(`manifesto/v1/fingerprint\n${keys.exchange}\n${keys.signing}`),
    ),
  );
  const hex = [...digest.subarray(0, 12)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return hex.match(/.{4}/g)?.join(" ") ?? hex;
}
