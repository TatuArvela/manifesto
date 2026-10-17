import type { SealedAccountPrefs } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "#/storage/index.ts";
import { hiddenTags, stickyTopBar, theme } from "./prefs.ts";
import { receiveAccountPrefs, startPrefsSync } from "./prefsSync.ts";
import { serverDefaultPrefs } from "./serverDefaults.ts";

const SERVER = "http://server.test";
const fetchMock = vi.fn<typeof fetch>();
let stored: Record<string, unknown>;
let patches: Record<string, unknown>[];
let session = 0;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Answers like the server: a GET gives the stored copy, a PATCH merges. */
function serve(delayGet?: Promise<void>) {
  fetchMock.mockImplementation(async (url, init) => {
    expect(String(url)).toBe(`${SERVER}/api/auth/me/prefs`);
    if (init?.method === "PATCH") {
      const { prefs } = JSON.parse(String(init.body));
      patches.push(prefs);
      stored = { ...stored, ...prefs };
      return json({ prefs: stored });
    }
    await delayGet;
    return json({ prefs: stored });
  });
}

function signIn() {
  session++;
  storageConnection.value = { serverUrl: SERVER, token: `tok-${session}` };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: null, token: null };
  theme.value = "system";
  hiddenTags.value = [];
  stickyTopBar.value = true;
  stored = {};
  patches = [];
  serverDefaultPrefs.value = { prefs: {}, signedIn: true };
  startPrefsSync();
});

afterEach(() => {
  storageConnection.value = { serverUrl: null, token: null };
  vi.unstubAllGlobals();
});

const sent = () => Object.assign({}, ...patches) as Record<string, unknown>;

describe("preferences that follow the account", () => {
  it("gives an account with none stored this device's, but not the device's own", async () => {
    serve();
    hiddenTags.value = ["work"];
    signIn();
    await vi.waitFor(() => expect(patches).toHaveLength(1), { timeout: 2000 });
    expect(sent()).toMatchObject({ hiddenTags: ["work"], theme: "system" });
    expect(sent()).not.toHaveProperty("stickyTopBar");
    expect(sent()).not.toHaveProperty("boardUsePicture");
  });

  it("takes the account's for every key it has, and fills in the rest", async () => {
    stored = { theme: "dark", hiddenTags: ["private"] };
    serve();
    signIn();
    await vi.waitFor(() => expect(theme.value).toBe("dark"));
    expect(hiddenTags.value).toEqual(["private"]);
    await vi.waitFor(() => expect(patches).toHaveLength(1), { timeout: 2000 });
    expect(sent()).not.toHaveProperty("theme");
    expect(sent()).not.toHaveProperty("hiddenTags");
    expect(sent()).toHaveProperty("locale");
  });

  it("gives a key the account lacks the host's default, and stores it", async () => {
    serverDefaultPrefs.value = {
      prefs: { theme: "dark", hiddenTags: ["work"], stickyTopBar: false },
      signedIn: true,
    };
    stored = { hiddenTags: ["private"] };
    serve();
    signIn();
    await vi.waitFor(() => expect(theme.value).toBe("dark"));
    // The account's own value wins over the default.
    expect(hiddenTags.value).toEqual(["private"]);
    // A device's own preference is never the account's to set.
    expect(stickyTopBar.value).toBe(true);
    await vi.waitFor(() => expect(patches).toHaveLength(1), { timeout: 2000 });
    expect(sent()).toMatchObject({ theme: "dark" });
    expect(sent()).not.toHaveProperty("hiddenTags");
  });

  it("reads a value it does not know as its default", async () => {
    theme.value = "dark";
    stored = { theme: "purple" };
    serve();
    signIn();
    await vi.waitFor(() => expect(theme.value).toBe("system"));
  });

  it("sends a change made here as a patch of that key alone", async () => {
    serve();
    signIn();
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), {
      timeout: 2000,
    });
    patches = [];
    hiddenTags.value = ["work"];
    await vi.waitFor(
      () => expect(patches).toEqual([{ hiddenTags: ["work"] }]),
      {
        timeout: 2000,
      },
    );
  });

  it("keeps the device's own preferences to itself", async () => {
    serve();
    signIn();
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), {
      timeout: 2000,
    });
    patches = [];
    stickyTopBar.value = false;
    await new Promise((r) => setTimeout(r, 700));
    expect(patches).toEqual([]);
  });

  it("adopts another device's change without sending it back", async () => {
    serve();
    signIn();
    await vi.waitFor(() => expect(patches.length).toBeGreaterThan(0), {
      timeout: 2000,
    });
    patches = [];
    // Readable, as this project's stand-in for sealing hands them through.
    await receiveAccountPrefs({
      theme: "dark",
      hiddenTags: ["home"],
    } as unknown as SealedAccountPrefs);
    expect(theme.value).toBe("dark");
    expect(hiddenTags.value).toEqual(["home"]);
    await new Promise((r) => setTimeout(r, 700));
    expect(patches).toEqual([]);
  });

  it("keeps a change made here before the account's copy arrived", async () => {
    stored = { theme: "light", hiddenTags: ["private"] };
    let release = () => {};
    serve(new Promise<void>((r) => (release = r)));
    signIn();
    theme.value = "dark";
    release();
    await vi.waitFor(() => expect(hiddenTags.value).toEqual(["private"]));
    expect(theme.value).toBe("dark");
    await vi.waitFor(() => expect(sent()).toMatchObject({ theme: "dark" }), {
      timeout: 2000,
    });
  });
});
