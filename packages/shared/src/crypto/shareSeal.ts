import type { AccountPublicKeys } from "#/api/keys.ts";
import { base64urlToBytes, bytesToBase64url, utf8, wipe } from "./bytes.ts";
import { associatedData, derivable, deriveKey, seal, unseal } from "./seal.ts";

/**
 * How a note key goes to a different account
 * (`docs/specification/features/encryption.md`, "Sharing").
 *
 * The key is wrapped to the public key of the recipient. The code makes an
 * ephemeral ECDH key for the one wrap. The key that both sides can derive from
 * it seals the note key. A wrap to a public key needs no secret, and the server
 * knows all public keys. Thus, a wrapped key alone tells nothing about who made
 * it. For this reason, the account that wraps also signs it, together with the
 * note, the version of the key and the account that it is for. The recipient
 * uses no wrapped key whose signature does not pass the check against the key
 * that it remembers for the signer.
 */

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const SIGNING = { name: "ECDSA", namedCurve: "P-256" } as const;
const SIGNATURE = { name: "ECDSA", hash: "SHA-256" } as const;

/** A note key on its way to an account, as the server sends it. */
export interface OfferedKey {
  /** The note key that this is. */
  keyVersion: number;
  /** The public half of the key made for this one wrap. */
  ephemeral: string;
  /** The note key, sealed under the agreement of the two public keys. */
  wrapped: string;
  /** The account that wrapped and signed it. */
  signer: string;
  /** Its signature over the note, the version, the recipient and the wrap. */
  signature: string;
}

/** The purpose of a wrap. The signature and the seal both bind it to this. */
export interface OfferContext {
  noteId: string;
  recipientId: string;
}

/** The maximum length of the parts of an offered key, for a server check. */
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
 * Wraps a note key for `context.recipientId`, and signs it as `signer`. Throws
 * when `recipientKey` is not a P-256 point.
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

/**
 * If the holder of `signerKey` signed `offer` for this note and recipient.
 * False for all malformed input.
 */
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
 * The note key of an offer, opened with the private key of the recipient. Null
 * when it does not open. The caller checks the signature first, and wipes the
 * bytes.
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
 * A short fingerprint of the two public keys of an account, for two people to
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
