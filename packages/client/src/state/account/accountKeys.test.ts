import type {
  AccountKeysSetupRequest,
  RecoveryCompleteRequest,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/config.ts", async (original) => ({
  ...(await original<typeof import("#/config.ts")>()),
  resolveServerUrl: () => "https://notes.example",
  resolveServerOrigin: () => "https://notes.example",
}));

const { authToken, currentUser } = await import("./auth.ts");
const keys = await import("./accountKeys.ts");
const { newUserKey, parseUserKey } = await import("#/utils/userKey.ts");

const USER = {
  id: "01HZX3KQ0000000000000000AA",
  username: "alice",
  displayName: "Alice",
  avatarColor: "#000",
  email: null,
  isAdmin: false,
  hasPassword: true,
};
const PASSWORD = "test-pass-12";
const ENDS = "2099-01-01T00:00:00.000Z";

/**
 * The server side of the keys of an account, as much as the client uses. It
 * stores what it gets, checks the recovery key by its verifier and the password
 * by a comparison, and can open none of it.
 */
interface Stored extends AccountKeysSetupRequest {
  version: number;
}
let stored: Stored | null;
/** The next key is replaced, but its answer never arrives. */
let loseAnswer = false;
let requests: { method: string; path: string; body: unknown }[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const empty = (status = 204) => new Response(null, { status });
const refused = (code: string) => json({ error: code, code }, 403);

function replaceWith(body: RecoveryCompleteRequest): Response {
  if (!stored || body.verifier !== stored.recoveryVerifier) {
    return refused("recovery_key_invalid");
  }
  stored = {
    ...stored,
    wrappedBySecret: body.wrappedBySecret,
    wrappedByRecovery: body.wrappedByRecovery,
    recoveryVerifier: body.recoveryVerifier,
  };
  return empty();
}

async function server(input: string, init?: RequestInit): Promise<Response> {
  const path = input.replace("https://notes.example/api/v1", "");
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  requests.push({ method, path, body });
  const wrongPassword = body?.password !== PASSWORD;
  switch (`${method} ${path}`) {
    case "GET /auth/keys":
      return json({
        keys: stored && {
          version: stored.version,
          wrappedBySecret: stored.wrappedBySecret,
          publicKeys: stored.publicKeys,
          wrappedPrivateKeys: stored.wrappedPrivateKeys,
        },
        sessionEndsAt: ENDS,
      });
    case "PUT /auth/keys":
      if (stored) return json({ error: "exists" }, 409);
      stored = { ...(body as AccountKeysSetupRequest), version: 1 };
      return empty();
    case "DELETE /auth/keys":
      if (wrongPassword) return refused("password_incorrect");
      stored = null;
      return empty();
    case "POST /auth/keys/confirm":
      return wrongPassword ? refused("password_incorrect") : empty();
    case "POST /auth/keys/secret":
      if (wrongPassword) return refused("password_incorrect");
      if (stored) stored = { ...stored, wrappedBySecret: body.wrappedBySecret };
      if (loseAnswer) throw new TypeError("connection reset");
      return empty();
    case "POST /auth/keys/recovery":
      if (wrongPassword) return refused("password_incorrect");
      if (stored) {
        stored = {
          ...stored,
          wrappedByRecovery: body.wrappedByRecovery,
          recoveryVerifier: body.recoveryVerifier,
        };
      }
      return empty();
    case "POST /auth/keys/recover":
    case "POST /auth/recovery":
      if (!stored || body.verifier !== stored.recoveryVerifier) {
        return json({ error: "no" }, path === "/auth/recovery" ? 401 : 403);
      }
      return json({
        userId: USER.id,
        version: stored.version,
        wrappedByRecovery: stored.wrappedByRecovery,
        hasPassword: true,
      });
    case "POST /auth/keys/recover/complete":
      return replaceWith(body);
    case "POST /auth/recovery/complete": {
      const replaced = replaceWith(body);
      if (!replaced.ok) return json({ error: "no" }, 401);
      return json({ token: "session-after-recovery", user: USER });
    }
    default:
      return json({ error: "not found" }, 404);
  }
}

const state = (kind: string) =>
  vi.waitFor(() => expect(keys.keyState.value).toBe(kind));

async function signIn(): Promise<void> {
  authToken.value = "session-1";
  currentUser.value = USER;
}

async function signOut(): Promise<void> {
  authToken.value = null;
  currentUser.value = null;
  await state("none");
}

/** Sets up the account and answers the sheet that it got. */
async function setUp() {
  await signIn();
  await state("setup");
  const sheet = await keys.prepareSetup();
  expect(await keys.completeSetup()).toBe("ok");
  if (!sheet?.secretKey || !sheet.recoveryKey) throw new Error("no sheet");
  return { secretKey: sheet.secretKey, recoveryKey: sheet.recoveryKey };
}

/** As a different device would be: signed in, with nothing held. */
async function signInAfresh(): Promise<void> {
  await signOut();
  await signIn();
  await state("locked");
}

describe("account keys", () => {
  beforeEach(() => {
    stored = null;
    loseAnswer = false;
    requests = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => server(input, init)),
    );
  });

  afterEach(async () => {
    await signOut();
    vi.unstubAllGlobals();
  });

  it("has nothing to unlock while nobody is signed in", () => {
    expect(keys.keyState.value).toBe("none");
    expect(keys.accountKey()).toBeNull();
  });

  it("sets an account up at its first sign-in, once the sheet is kept", async () => {
    await signIn();
    await state("setup");
    const sheet = await keys.prepareSetup();
    expect(sheet).toMatchObject({
      server: "https://notes.example",
      username: "alice",
    });
    expect(parseUserKey(sheet?.secretKey ?? "", "secret")).toBe(
      sheet?.secretKey,
    );
    expect(parseUserKey(sheet?.recoveryKey ?? "", "recovery")).toBe(
      sheet?.recoveryKey,
    );
    // Nothing reached the server while the sheet only shows, and when it shows
    // again, it shows the same keys.
    expect(stored).toBeNull();
    expect(await keys.prepareSetup()).toEqual(sheet);
    expect(keys.accountKey()).toBeNull();

    expect(await keys.completeSetup()).toBe("ok");
    expect(keys.keyState.value).toBe("unlocked");
    expect(keys.accountKey()).not.toBeNull();
    // What was sent contains neither key that a person keeps.
    const sent = JSON.stringify(requests);
    expect(sent).not.toContain(sheet?.secretKey);
    expect(sent).not.toContain(sheet?.recoveryKey);
  });

  it("keeps the sheet it showed when the same account is only described anew", async () => {
    await signIn();
    await state("setup");
    const sheet = await keys.prepareSetup();
    const asked = requests.length;
    // A new display name or language, as a refresh of the account brings.
    currentUser.value = { ...USER, displayName: "Alice A." };
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keys.keyState.value).toBe("setup");
    expect(requests.length).toBe(asked);
    // The keys already on the screen, or on paper, are the keys that were set
    // up.
    expect(await keys.prepareSetup()).toEqual(sheet);
    expect(await keys.completeSetup()).toBe("ok");
  });

  it("asks for the other device's key when that one set the account up first", async () => {
    await signIn();
    await state("setup");
    await keys.prepareSetup();
    stored = { ...(await otherDeviceSetup()), version: 1 };
    expect(await keys.completeSetup()).toBe("exists");
    expect(keys.keyState.value).toBe("locked");
  });

  it("is locked at every later sign-in until the secret key is entered", async () => {
    const { secretKey, recoveryKey } = await setUp();
    await signInAfresh();
    expect(keys.accountKey()).toBeNull();
    expect(await keys.unlock("not a key")).toBe("invalid");
    expect(await keys.unlock(recoveryKey)).toBe("invalid");
    expect(await keys.unlock(newUserKey("secret"))).toBe("wrong");
    expect(keys.keyState.value).toBe("locked");
    // However it is typed.
    expect(await keys.unlock(secretKey.toLowerCase().replace(/-/g, " "))).toBe(
      "ok",
    );
    expect(keys.keyState.value).toBe("unlocked");
    expect(keys.accountKey()).not.toBeNull();
  });

  it("removes what it holds when the session ends", async () => {
    await setUp();
    expect(keys.accountKey()).not.toBeNull();
    await signOut();
    expect(keys.accountKey()).toBeNull();
    await signIn();
    await state("locked");
  });

  it("holds nothing when the session ends while a set-up is being sent", async () => {
    await signIn();
    await state("setup");
    await keys.prepareSetup();
    const setup = keys.completeSetup();
    // Signed out while the request is on its way.
    authToken.value = null;
    currentUser.value = null;
    expect(await setup).toBe("failed");
    await state("none");
    expect(keys.accountKey()).toBeNull();
  });

  it("says when the server cannot be asked, and asks again", async () => {
    await setUp();
    await signOut();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    await signIn();
    await state("unavailable");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string, init?: RequestInit) => server(input, init)),
    );
    await keys.checkAccountKeys();
    expect(keys.keyState.value).toBe("locked");
  });

  it("shows the secret key only after the password", async () => {
    const { secretKey } = await setUp();
    expect(await keys.revealSecretKey("wrong-pass-00")).toEqual({
      kind: "password-wrong",
    });
    expect(await keys.revealSecretKey(PASSWORD)).toEqual({
      kind: "ok",
      secretKey,
    });
  });

  it("makes a new secret key, which is the one that unlocks from then on", async () => {
    const { secretKey } = await setUp();
    expect((await keys.prepareSecretKey("wrong-pass-00")).kind).toBe(
      "password-wrong",
    );
    const made = await keys.prepareSecretKey(PASSWORD);
    if (made.kind !== "ok") throw new Error(made.kind);
    expect(made.secretKey).not.toBe(secretKey);
    // Nothing is replaced until the sheet is kept.
    const before = stored?.wrappedBySecret;
    expect(requests.some((r) => r.path === "/auth/keys/secret")).toBe(false);
    expect(await keys.revealSecretKey(PASSWORD)).toEqual({
      kind: "ok",
      secretKey,
    });
    expect((await keys.completeRenewal(PASSWORD)).kind).toBe("ok");
    expect(stored?.wrappedBySecret).not.toBe(before);
    // This device continues, and now has the new key to show.
    expect(keys.keyState.value).toBe("unlocked");
    expect(await keys.revealSecretKey(PASSWORD)).toEqual({
      kind: "ok",
      secretKey: made.secretKey,
    });
    await signInAfresh();
    expect(await keys.unlock(secretKey)).toBe("wrong");
    expect(await keys.unlock(made.secretKey)).toBe("ok");
  });

  it("keeps the old secret key when the new one's sheet is not kept", async () => {
    const { secretKey } = await setUp();
    const made = await keys.prepareSecretKey(PASSWORD);
    if (made.kind !== "ok") throw new Error(made.kind);
    keys.abandonRenewal();
    expect((await keys.completeRenewal(PASSWORD)).kind).toBe("failed");
    await signInAfresh();
    expect(await keys.unlock(made.secretKey)).toBe("wrong");
    expect(await keys.unlock(secretKey)).toBe("ok");
  });

  it("goes on with the new secret key when the server took it but its answer was lost", async () => {
    await setUp();
    const made = await keys.prepareSecretKey(PASSWORD);
    if (made.kind !== "ok") throw new Error(made.kind);
    loseAnswer = true;
    expect((await keys.completeRenewal(PASSWORD)).kind).toBe("ok");
    loseAnswer = false;
    expect(await keys.revealSecretKey(PASSWORD)).toEqual({
      kind: "ok",
      secretKey: made.secretKey,
    });
  });

  it("makes a new recovery key, and the old one stops working once it is kept", async () => {
    const { recoveryKey } = await setUp();
    const made = await keys.prepareRecoveryKey(PASSWORD);
    if (made.kind !== "ok") throw new Error(made.kind);
    expect(made.recoveryKey).not.toBe(recoveryKey);
    expect(requests.some((r) => r.path === "/auth/keys/recovery")).toBe(false);
    expect((await keys.completeRenewal("wrong-pass-00")).kind).toBe(
      "password-wrong",
    );
    expect((await keys.completeRenewal(PASSWORD)).kind).toBe("ok");
    await signInAfresh();
    expect((await keys.beginRecovery(recoveryKey)).kind).toBe("wrong");
    expect((await keys.beginRecovery(made.recoveryKey)).kind).toBe("ok");
  });

  it("unlocks with the recovery key and replaces both keys", async () => {
    const { secretKey, recoveryKey } = await setUp();
    await signInAfresh();
    expect((await keys.beginRecovery("nonsense")).kind).toBe("invalid");
    expect((await keys.beginRecovery(secretKey)).kind).toBe("invalid");
    const begun = await keys.beginRecovery(recoveryKey);
    if (begun.kind !== "ok") throw new Error(begun.kind);
    const { sheet } = begun;
    expect(sheet.secretKey).not.toBe(secretKey);
    expect(sheet.recoveryKey).not.toBe(recoveryKey);
    // Nothing is replaced until the new sheet is kept.
    expect(keys.keyState.value).toBe("locked");
    const before = stored?.wrappedBySecret;
    expect(await keys.completeRecovery()).toBe("ok");
    expect(keys.keyState.value).toBe("unlocked");
    expect(stored?.wrappedBySecret).not.toBe(before);

    await signInAfresh();
    expect(await keys.unlock(secretKey)).toBe("wrong");
    expect((await keys.beginRecovery(recoveryKey)).kind).toBe("wrong");
    expect(await keys.unlock(sheet.secretKey ?? "")).toBe("ok");
  });

  it("signs in with the recovery key and the username, already unlocked", async () => {
    const { recoveryKey } = await setUp();
    await signOut();
    expect((await keys.beginRecoverySignIn("alice", "RK-nope")).kind).toBe(
      "invalid",
    );
    const begun = await keys.beginRecoverySignIn("alice", recoveryKey);
    if (begun.kind !== "ok") throw new Error(begun.kind);
    expect(begun.sheet.username).toBe("alice");
    expect(authToken.value).toBeNull();
    expect(await keys.completeRecovery("a-new-pass-34")).toBe("ok");
    expect(authToken.value).toBe("session-after-recovery");
    expect(keys.keyState.value).toBe("unlocked");
    const sent = requests.find((r) => r.path === "/auth/recovery/complete");
    expect(sent?.body).toMatchObject({
      username: "alice",
      newPassword: "a-new-pass-34",
    });
    // The check that the sign-in started finds the account unlocked, and it
    // stays so.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(keys.keyState.value).toBe("unlocked");
  });

  it("starts the account again with the password, back at the set-up", async () => {
    const { secretKey } = await setUp();
    await signInAfresh();
    expect((await keys.startAgain("wrong-pass-00")).kind).toBe(
      "password-wrong",
    );
    expect(keys.keyState.value).toBe("locked");
    expect((await keys.startAgain(PASSWORD)).kind).toBe("ok");
    expect(keys.keyState.value).toBe("setup");
    const sheet = await keys.prepareSetup();
    expect(sheet?.secretKey).not.toBe(secretKey);
  });
});

/** A set-up as a different device would make it. */
async function otherDeviceSetup(): Promise<AccountKeysSetupRequest> {
  const { createAccountKeys } = await import("#/utils/keyMaterial.ts");
  return (await createAccountKeys(USER.id)).request;
}
