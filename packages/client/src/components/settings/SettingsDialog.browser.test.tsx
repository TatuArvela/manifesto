import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "#/i18n/index.ts";

vi.mock("#/config.ts", async (original) => ({
  ...(await original<typeof import("#/config.ts")>()),
  resolveServerUrl: () => "https://notes.example",
}));

import { currentUser } from "#/state/account/auth.ts";
import {
  adoptServerFeatures,
  DEFAULT_SERVER_FEATURES,
  type ServerFeatures,
  serverFeatures,
} from "#/state/serverFeatures.ts";
import { settingsTab, showSettings } from "#/state/ui.ts";
import { storageConnection } from "#/storage/index.ts";
import { SettingsDialog } from "./SettingsDialog.tsx";

let host: HTMLDivElement;

/** The labels of the pages in the dialog's navigation. */
function pages(): string[] {
  const nav = host.querySelector(`nav[aria-label="${t("settings.title")}"]`);
  return [...(nav?.querySelectorAll("button") ?? [])].map(
    (b) => b.textContent?.trim() ?? "",
  );
}

function open(features: Partial<ServerFeatures>) {
  serverFeatures.value = { ...DEFAULT_SERVER_FEATURES, ...features };
  render(<SettingsDialog />, host);
}

describe("SettingsDialog account pages", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    currentUser.value = {
      id: "u1",
      username: "alice",
      displayName: "Alice",
      avatarColor: "#000",
      email: null,
      isAdmin: false,
      hasPassword: true,
    };
    settingsTab.value = "appearance";
    showSettings.value = true;
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    showSettings.value = false;
    currentUser.value = null;
    serverFeatures.value = DEFAULT_SERVER_FEATURES;
  });

  it("shows a page for each feature the server has on", async () => {
    open({ webhooks: true });
    await vi.waitFor(() => expect(pages()).toContain(t("webhooks.title")));
    expect(pages()).toContain(t("twoFactor.title"));
    expect(pages()).toContain(t("tokens.title"));
    expect(pages()).toContain(t("keys.title"));
  });

  it("hides the pages of features the server has off", async () => {
    open({
      webhooks: false,
      apiTokens: false,
      mcp: false,
      calendar: false,
      twoFactor: false,
      passkeys: false,
    });
    await vi.waitFor(() => expect(pages()).toContain(t("activity.title")));
    expect(pages()).not.toContain(t("webhooks.title"));
    expect(pages()).not.toContain(t("tokens.title"));
    expect(pages()).not.toContain(t("twoFactor.title"));
    // The keys are no feature: every account has them.
    expect(pages()).toContain(t("keys.title"));
  });

  it("keeps the two-factor page for an account that has one when both halves are off", async () => {
    // Sign-in still asks for the factor, so the page that removes it stays.
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ enabled: true, authenticator: true }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    storageConnection.value = {
      serverUrl: "https://notes.example",
      token: "tok",
    };
    try {
      open({ twoFactor: false, passkeys: false });
      await vi.waitFor(() => expect(pages()).toContain(t("twoFactor.title")));
      expect(fetchMock).toHaveBeenCalledWith(
        "https://notes.example/api/auth/two-factor",
        expect.anything(),
      );
    } finally {
      vi.unstubAllGlobals();
      storageConnection.value = { serverUrl: null, token: null };
    }
  });

  it("keeps a page while any of what it holds is on", async () => {
    // Only calendar tokens, and only passkeys.
    open({ apiTokens: false, mcp: false, twoFactor: false });
    await vi.waitFor(() => expect(pages()).toContain(t("tokens.title")));
    expect(pages()).toContain(t("twoFactor.title"));
  });

  it("follows what the server reports, defaults for what it leaves out", () => {
    adoptServerFeatures({ webhooks: true, sharing: false });
    expect(serverFeatures.value).toMatchObject({
      webhooks: true,
      sharing: false,
      // Not reported, as by a server from before the switch: as it was.
      teams: true,
    });
  });
});

describe("searching Settings", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    settingsTab.value = "features";
    showSettings.value = true;
    render(<SettingsDialog />, host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    showSettings.value = false;
  });

  const field = () =>
    host.querySelector<HTMLInputElement>('input[type="search"]');
  const search = (query: string) => {
    const input = field();
    if (!input) throw new Error("no search field");
    input.value = query;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const results = () => [
    ...(host
      .querySelector(`section[aria-label="${t("settings.searchResults")}"]`)
      ?.querySelectorAll("button") ?? []),
  ];

  it("lists a setting with its page, and takes the reader to it", async () => {
    search(t("settings.animations").toLowerCase());
    await vi.waitFor(() => expect(results().length).toBe(1));
    expect(results()[0]?.textContent).toContain(t("settings.group.appearance"));

    results()[0]?.click();
    await vi.waitFor(() => expect(settingsTab.value).toBe("appearance"));
    await vi.waitFor(() => {
      const row = host.querySelector(".settings-found");
      expect(row?.textContent).toContain(t("settings.animations"));
    });
    expect(field()?.value).toBe("");
  });

  it("finds a page by its name and says when nothing matches", async () => {
    search(t("settings.boardBackground"));
    await vi.waitFor(() =>
      expect(results().map((b) => b.textContent)).toContain(
        t("settings.boardBackground"),
      ),
    );
    search(t("settings.group.data"));
    await vi.waitFor(() =>
      expect(results().map((b) => b.textContent)).toContain(
        t("settings.group.data"),
      ),
    );
    search("zzzz");
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("settings.searchNone")),
    );
  });
});
