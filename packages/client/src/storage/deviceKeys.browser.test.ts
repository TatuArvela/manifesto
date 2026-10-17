import { associatedData, seal, unseal } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { accountSubkey, createAccountKeys } from "#/utils/keyMaterial.js";
import {
  clearDeviceKeys,
  type DeviceKeys,
  loadDeviceKeys,
  saveDeviceKeys,
} from "./deviceKeys.js";

const USER = "01HZX3KQ0000000000000000AA";
const data = associatedData({ id: "n1", field: "title", version: 1 });

async function deviceKeys(): Promise<DeviceKeys> {
  const made = await createAccountKeys(USER);
  return {
    userId: USER,
    version: made.version,
    secretKey: made.secretKey,
    accountKey: made.accountKey,
    endsAt: "2099-01-01T00:00:00.000Z",
  };
}

describe("deviceKeys", () => {
  beforeEach(clearDeviceKeys);
  afterEach(clearDeviceKeys);

  it("holds nothing until keys are saved", async () => {
    expect(await loadDeviceKeys()).toBeNull();
  });

  it("gives back the keys it was given, the account key still usable and still unreadable", async () => {
    const keys = await deviceKeys();
    expect(await saveDeviceKeys(keys)).toBe(true);
    const loaded = await loadDeviceKeys();
    expect(loaded).toMatchObject({
      userId: USER,
      version: 1,
      secretKey: keys.secretKey,
      endsAt: keys.endsAt,
    });
    if (!loaded) return;
    expect(loaded.accountKey.extractable).toBe(false);
    // The same key: what the one in hand sealed, the stored one opens.
    const sealed = await seal(
      await accountSubkey(keys.accountKey, "notes"),
      new TextEncoder().encode("x"),
      data,
    );
    const opened = await unseal(
      await accountSubkey(loaded.accountKey, "notes"),
      sealed,
      data,
    );
    expect(opened && new TextDecoder().decode(opened)).toBe("x");
  });

  it("keeps one account's keys, the latest saved", async () => {
    await saveDeviceKeys(await deviceKeys());
    const next = { ...(await deviceKeys()), userId: "someone-else" };
    await saveDeviceKeys(next);
    expect((await loadDeviceKeys())?.userId).toBe("someone-else");
  });

  it("removes them", async () => {
    await saveDeviceKeys(await deviceKeys());
    await clearDeviceKeys();
    expect(await loadDeviceKeys()).toBeNull();
  });
});
