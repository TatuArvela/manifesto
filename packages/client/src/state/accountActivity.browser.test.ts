import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "../storage/index.js";
import { loadAccountActivity } from "./accountActivity.js";

const SERVER = "http://server.test";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: SERVER, token: "tok" };
});

afterEach(() => {
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
});

describe("loadAccountActivity", () => {
  it("reads the user's own activity, older than a given entry", async () => {
    const page = { entries: [], nextBefore: null };
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(page), { status: 200 }),
    );
    expect(await loadAccountActivity("01ABC")).toEqual(page);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${SERVER}/api/auth/me/activity?before=01ABC`,
    );
  });

  it("resolves with null when it cannot be read", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    expect(await loadAccountActivity()).toBeNull();
  });
});
