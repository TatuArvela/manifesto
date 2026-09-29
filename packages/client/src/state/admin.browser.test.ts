import type { AdminUser } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "../storage/index.js";
import {
  adminUsers,
  createAccount,
  deleteAccount,
  issuedPassword,
  loadAdminUsers,
  resetAccountPassword,
  setAccountAdmin,
} from "./admin.js";
import { locale } from "./prefs.js";
import { activeView, toasts } from "./ui.js";

const SERVER = "http://server.test";

function user(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: "u-bob",
    username: "bob",
    displayName: "bob",
    avatarColor: "#3b82f6",
    email: null,
    isAdmin: false,
    provider: "local",
    mustChangePassword: false,
    noteCount: 0,
    createdAt: "2026-04-01T00:00:00.000Z",
    lastSeenAt: null,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn<typeof fetch>();
const onUnauthorized = vi.fn();

beforeEach(() => {
  locale.value = "en";
  fetchMock.mockReset();
  onUnauthorized.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: SERVER, token: "tok", onUnauthorized };
  adminUsers.value = [
    user({ id: "u-admin", username: "admin", isAdmin: true }),
  ];
  issuedPassword.value = null;
  toasts.value = [];
  activeView.value = "admin";
});

afterEach(() => {
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
  adminUsers.value = null;
  issuedPassword.value = null;
  toasts.value = [];
  activeView.value = "active";
});

describe("admin actions", () => {
  it("loads the accounts with the session's bearer token", async () => {
    fetchMock.mockResolvedValueOnce(json({ users: [user()] }));
    expect(await loadAdminUsers()).toBe(true);
    expect(adminUsers.value?.map((u) => u.username)).toEqual(["bob"]);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`${SERVER}/api/admin/users`);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("reaches a same-origin server, whose base is the empty string", async () => {
    storageConnection.value = { serverUrl: "", token: "tok", onUnauthorized };
    fetchMock.mockResolvedValueOnce(json({ users: [user()] }));
    expect(await loadAdminUsers()).toBe(true);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/users");
  });

  it("adds a created account in order and holds its password to show once", async () => {
    adminUsers.value = [
      user({ id: "u-admin", username: "admin" }),
      user({ id: "u-zed", username: "zed" }),
    ];
    fetchMock.mockResolvedValueOnce(
      json(
        {
          user: user({ id: "u-carol", username: "Carol" }),
          temporaryPassword: "abcd-efgh-jkmn-pqrs",
        },
        201,
      ),
    );
    expect(await createAccount("Carol")).toBe(true);
    expect(adminUsers.value?.map((u) => u.username)).toEqual([
      "admin",
      "Carol",
      "zed",
    ]);
    expect(issuedPassword.value).toEqual({
      username: "Carol",
      password: "abcd-efgh-jkmn-pqrs",
      kind: "created",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      username: "Carol",
    });
  });

  it("says a username is taken in its own words, not the server's", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "Username is already taken" }, 409),
    );
    expect(await createAccount("bob")).toBe(false);
    expect(toasts.value.map((toast) => toast.message)).toEqual([
      "That username is already taken.",
    ]);
    expect(issuedPassword.value).toBeNull();
  });

  it("replaces an account whose admin rights changed", async () => {
    adminUsers.value = [user()];
    fetchMock.mockResolvedValueOnce(json({ user: user({ isAdmin: true }) }));
    expect(await setAccountAdmin("u-bob", true)).toBe(true);
    expect(adminUsers.value?.[0]?.isAdmin).toBe(true);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
  });

  it("explains a refusal to remove the last admin", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: "The server must keep at least one admin" }, 409),
    );
    expect(await deleteAccount("u-admin")).toBe(false);
    expect(toasts.value[0]?.message).toBe(
      "The server needs at least one admin.",
    );
    expect(adminUsers.value).toHaveLength(1);
  });

  it("holds a reset password to show once", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        user: user({ mustChangePassword: true }),
        temporaryPassword: "wxyz-2345-6789-abcd",
      }),
    );
    expect(await resetAccountPassword("u-bob")).toBe(true);
    expect(issuedPassword.value).toMatchObject({
      username: "bob",
      kind: "reset",
    });
  });

  it("drops a deleted account from the list", async () => {
    adminUsers.value = [user({ id: "u-admin" }), user()];
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await deleteAccount("u-bob")).toBe(true);
    expect(adminUsers.value?.map((u) => u.id)).toEqual(["u-admin"]);
  });

  it("takes someone who has lost admin rights back to their notes", async () => {
    fetchMock.mockResolvedValue(json({ error: "Admin access required" }, 403));
    expect(await loadAdminUsers()).toBe(false);
    expect(activeView.value).toBe("active");
    expect(adminUsers.value).toBeNull();
    expect(toasts.value[0]?.message).toBe("You no longer have admin rights.");
  });

  it("signs out on 401 without a toast of its own", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "expired" }, 401));
    expect(await loadAdminUsers()).toBe(false);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(toasts.value).toEqual([]);
  });

  it("reports a network failure and resolves", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await setAccountAdmin("u-bob", true)).toBe(false);
    expect(toasts.value[0]?.message).toBe("Could not change admin rights.");
  });
});
