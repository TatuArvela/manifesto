import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", async (original) => ({
  ...(await original<typeof import("../config.js")>()),
  resolveServerUrl: () => "https://notes.example",
}));

const { authToken, currentUser } = await import("./auth.js");
const { locale } = await import("./prefs.js");
const { startAccountLocaleReport } = await import("./accountLocale.js");

const user = {
  id: "u1",
  username: "alice",
  displayName: "Alice",
  avatarColor: "#000",
  email: null,
  isAdmin: false,
};

describe("reporting the app's language", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  let stop: () => void;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    locale.value = "en";
    stop = startAccountLocaleReport();
  });
  afterEach(() => {
    stop();
    authToken.value = null;
    currentUser.value = null;
    fetchMock.mockClear();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("tells the server when the language held for the account differs", async () => {
    authToken.value = "t";
    currentUser.value = { ...user, locale: null };
    await vi.waitFor(() => expect(currentUser.value?.locale).toBe("en"));
    locale.value = "fi";
    await vi.waitFor(() => expect(currentUser.value?.locale).toBe("fi"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://notes.example/api/auth/me/locale");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ locale: "fi" });
  });

  it("asks nothing of a server that does not keep one", async () => {
    authToken.value = "t";
    currentUser.value = { ...user };
    locale.value = "fi";
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
