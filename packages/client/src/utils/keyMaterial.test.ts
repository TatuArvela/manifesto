import {
  associatedData,
  isCiphertext,
  MAX_WRAPPED_KEY_LENGTH,
  PUBLIC_KEY_LENGTH,
  RECOVERY_VERIFIER_LENGTH,
  seal,
  unseal,
} from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import {
  accountSubkey,
  createAccountKeys,
  openPrivateKey,
  recoverAccountKey,
  recoveryVerifierOf,
  replaceRecoveryKey,
  replaceSecretKey,
  unlockAccountKey,
} from "./keyMaterial.js";
import { newUserKey, parseUserKey } from "./userKey.js";

const USER = "01HZX3KQ0000000000000000AA";
const data = associatedData({ id: "n1", field: "title", version: 1 });
const text = (value: string) => new TextEncoder().encode(value);
const read = (bytes: Uint8Array | null) =>
  bytes === null ? null : new TextDecoder().decode(bytes);

/** Whether two account keys are the same key: what one seals, the other
 * opens. The keys themselves cannot be read out to compare. */
async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const sealed = await seal(await accountSubkey(a, "notes"), text("x"), data);
  return (
    read(await unseal(await accountSubkey(b, "notes"), sealed, data)) === "x"
  );
}

/** What the server would hand back to a signed-in device. */
function served(made: Awaited<ReturnType<typeof createAccountKeys>>) {
  return {
    version: made.version,
    wrappedBySecret: made.request.wrappedBySecret,
    publicKeys: made.request.publicKeys,
    wrappedPrivateKeys: made.request.wrappedPrivateKeys,
  };
}

describe("createAccountKeys", () => {
  it("makes two keys to hold and sends the server only what it may keep", async () => {
    const made = await createAccountKeys(USER);
    expect(parseUserKey(made.secretKey, "secret")).toBe(made.secretKey);
    expect(parseUserKey(made.recoveryKey, "recovery")).toBe(made.recoveryKey);
    const { request } = made;
    for (const wrapped of [
      request.wrappedBySecret,
      request.wrappedByRecovery,
      request.wrappedPrivateKeys.exchange,
      request.wrappedPrivateKeys.signing,
    ]) {
      expect(isCiphertext(wrapped, MAX_WRAPPED_KEY_LENGTH)).toBe(true);
    }
    expect(request.publicKeys.exchange).toHaveLength(PUBLIC_KEY_LENGTH);
    expect(request.publicKeys.signing).toHaveLength(PUBLIC_KEY_LENGTH);
    expect(request.publicKeys.exchange.startsWith("B")).toBe(true);
    expect(request.recoveryVerifier).toHaveLength(RECOVERY_VERIFIER_LENGTH);
    const sent = JSON.stringify(request);
    expect(sent).not.toContain(made.secretKey);
    expect(sent).not.toContain(made.recoveryKey);
  });

  it("hands the device an account key that cannot be read out", async () => {
    const { accountKey } = await createAccountKeys(USER);
    expect(accountKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", accountKey)).rejects.toThrow();
    const notes = await accountSubkey(accountKey, "notes");
    expect(notes.extractable).toBe(false);
  });

  it("makes different keys for every account", async () => {
    const a = await createAccountKeys(USER);
    const b = await createAccountKeys(USER);
    expect(a.secretKey).not.toBe(b.secretKey);
    expect(await sameKey(a.accountKey, b.accountKey)).toBe(false);
  });

  it("derives a key of its own for each job", async () => {
    const { accountKey } = await createAccountKeys(USER);
    const sealed = await seal(
      await accountSubkey(accountKey, "notes"),
      text("x"),
      data,
    );
    expect(
      await unseal(await accountSubkey(accountKey, "personal"), sealed, data),
    ).toBeNull();
  });
});

describe("unlockAccountKey", () => {
  it("opens the account key with the secret key", async () => {
    const made = await createAccountKeys(USER);
    const unlocked = await unlockAccountKey(USER, served(made), made.secretKey);
    expect(unlocked).not.toBeNull();
    expect(await sameKey(made.accountKey, unlocked as CryptoKey)).toBe(true);
    expect(unlocked?.extractable).toBe(false);
  });

  it("does not open with another key, the recovery key, or for another account", async () => {
    const made = await createAccountKeys(USER);
    const keys = served(made);
    expect(await unlockAccountKey(USER, keys, newUserKey("secret"))).toBeNull();
    expect(await unlockAccountKey(USER, keys, made.recoveryKey)).toBeNull();
    expect(
      await unlockAccountKey("someone-else", keys, made.secretKey),
    ).toBeNull();
    expect(
      await unlockAccountKey(USER, { ...keys, version: 2 }, made.secretKey),
    ).toBeNull();
  });

  it("does not take the recovery key's wrap for the secret key's", async () => {
    const made = await createAccountKeys(USER);
    expect(
      await unlockAccountKey(
        USER,
        { version: 1, wrappedBySecret: made.request.wrappedByRecovery },
        made.recoveryKey,
      ),
    ).toBeNull();
  });

  it("opens the private keys with the account key", async () => {
    const made = await createAccountKeys(USER);
    const keys = served(made);
    const exchange = await openPrivateKey(
      made.accountKey,
      USER,
      keys,
      "exchange",
    );
    const signing = await openPrivateKey(
      made.accountKey,
      USER,
      keys,
      "signing",
    );
    expect(exchange?.algorithm.name).toBe("ECDH");
    expect(signing?.algorithm.name).toBe("ECDSA");
    expect(signing?.extractable).toBe(false);
    // Each half is bound to its field: one does not stand in for the other.
    expect(
      await openPrivateKey(
        made.accountKey,
        USER,
        {
          ...keys,
          wrappedPrivateKeys: {
            exchange: keys.wrappedPrivateKeys.signing,
            signing: keys.wrappedPrivateKeys.exchange,
          },
        },
        "exchange",
      ),
    ).toBeNull();
    // What the private key signs, the public key the server holds verifies.
    const publicKey = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(
        atob(keys.publicKeys.signing.replace(/-/g, "+").replace(/_/g, "/")),
        (c) => c.charCodeAt(0),
      ),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const algorithm = { name: "ECDSA", hash: "SHA-256" };
    const signature = await crypto.subtle.sign(
      algorithm,
      signing as CryptoKey,
      text("hello"),
    );
    expect(
      await crypto.subtle.verify(
        algorithm,
        publicKey,
        signature,
        text("hello"),
      ),
    ).toBe(true);
  });
});

describe("replaceSecretKey", () => {
  it("wraps the same account key under a new secret key", async () => {
    const made = await createAccountKeys(USER);
    const keys = served(made);
    const next = await replaceSecretKey(USER, keys, made.secretKey);
    expect(next).not.toBeNull();
    expect(next?.secretKey).not.toBe(made.secretKey);
    const after = { ...keys, wrappedBySecret: next?.wrappedBySecret ?? "" };
    const unlocked = await unlockAccountKey(USER, after, next?.secretKey ?? "");
    expect(await sameKey(made.accountKey, unlocked as CryptoKey)).toBe(true);
    // The key it replaced no longer opens what the server now holds.
    expect(await unlockAccountKey(USER, after, made.secretKey)).toBeNull();
  });

  it("makes nothing from a secret key that is not current", async () => {
    const made = await createAccountKeys(USER);
    expect(
      await replaceSecretKey(USER, served(made), newUserKey("secret")),
    ).toBeNull();
  });
});

describe("replaceRecoveryKey", () => {
  it("wraps the same account key under a new recovery key", async () => {
    const made = await createAccountKeys(USER);
    const next = await replaceRecoveryKey(USER, served(made), made.secretKey);
    expect(next).not.toBeNull();
    expect(next?.recoveryKey).not.toBe(made.recoveryKey);
    expect(next?.recoveryVerifier).not.toBe(made.request.recoveryVerifier);
    const recovered = await recoverAccountKey(
      {
        userId: USER,
        version: 1,
        wrappedByRecovery: next?.wrappedByRecovery ?? "",
      },
      next?.recoveryKey ?? "",
    );
    expect(
      await sameKey(made.accountKey, recovered?.accountKey as CryptoKey),
    ).toBe(true);
  });
});

describe("the recovery key", () => {
  it("proves itself with a value that is not the key and does not wrap", async () => {
    const made = await createAccountKeys(USER);
    expect(await recoveryVerifierOf(made.recoveryKey)).toBe(
      made.request.recoveryVerifier,
    );
    expect(await recoveryVerifierOf(newUserKey("recovery"))).not.toBe(
      made.request.recoveryVerifier,
    );
  });

  it("opens the account key and replaces both keys a person holds", async () => {
    const made = await createAccountKeys(USER);
    const opened = {
      userId: USER,
      version: 1,
      wrappedByRecovery: made.request.wrappedByRecovery,
    };
    const recovered = await recoverAccountKey(opened, made.recoveryKey);
    expect(recovered).not.toBeNull();
    if (!recovered) return;
    expect(await sameKey(made.accountKey, recovered.accountKey)).toBe(true);
    expect(recovered.secretKey).not.toBe(made.secretKey);
    expect(recovered.recoveryKey).not.toBe(made.recoveryKey);
    // The new secret key unlocks; the new recovery key recovers.
    const unlocked = await unlockAccountKey(
      USER,
      { version: 1, wrappedBySecret: recovered.wrappedBySecret },
      recovered.secretKey,
    );
    expect(await sameKey(made.accountKey, unlocked as CryptoKey)).toBe(true);
    expect(
      await recoverAccountKey(
        { ...opened, wrappedByRecovery: recovered.wrappedByRecovery },
        recovered.recoveryKey,
      ),
    ).not.toBeNull();
    expect(recovered.recoveryVerifier).toBe(
      await recoveryVerifierOf(recovered.recoveryKey),
    );
  });

  it("does not open with the secret key or another recovery key", async () => {
    const made = await createAccountKeys(USER);
    const opened = {
      userId: USER,
      version: 1,
      wrappedByRecovery: made.request.wrappedByRecovery,
    };
    expect(await recoverAccountKey(opened, made.secretKey)).toBeNull();
    expect(await recoverAccountKey(opened, newUserKey("recovery"))).toBeNull();
    expect(
      await recoverAccountKey(
        { ...opened, userId: "someone-else" },
        made.recoveryKey,
      ),
    ).toBeNull();
  });
});
