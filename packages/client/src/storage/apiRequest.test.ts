import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiJson } from "./apiRequest.js";
import { storageConnection } from "./index.js";

const fetchMock = vi.fn<typeof fetch>();
const onUnauthorized = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  onUnauthorized.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: "", token: "tok", onUnauthorized };
});

afterEach(() => {
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
});

describe("apiFetch", () => {
  it("sends to a same-origin server, whose base is the empty string", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const res = await apiFetch("POST", "/tokens", { name: "x" });
    expect(res?.status).toBe(204);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/tokens");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("sends nothing in open mode", async () => {
    storageConnection.value = { serverUrl: null, token: "tok" };
    expect(await apiFetch("GET", "/tokens")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ends the session on a 401 and resolves on a network failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect((await apiFetch("GET", "/tokens"))?.status).toBe(401);
    expect(onUnauthorized).toHaveBeenCalledOnce();

    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    expect(await apiFetch("GET", "/tokens")).toBeNull();
  });
});

describe("apiJson", () => {
  it("throws the status and error code of a refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "taken", code: "email_taken" }, { status: 409 }),
    );
    const err = await apiJson("PUT", "/admin/users/u1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: "email_taken" });
  });

  it("throws 401 without a session and 0 when the request never arrived", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    await expect(apiJson("GET", "/x")).rejects.toMatchObject({ status: 0 });

    storageConnection.value = { serverUrl: null, token: null };
    await expect(apiJson("GET", "/x")).rejects.toMatchObject({ status: 401 });
  });
});
