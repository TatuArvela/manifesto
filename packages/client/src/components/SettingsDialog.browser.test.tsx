import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";

vi.mock("../config.js", async (original) => ({
  ...(await original<typeof import("../config.js")>()),
  resolveServerUrl: () => "https://notes.example",
}));

import { currentUser } from "../state/auth.js";
import {
  adoptServerFeatures,
  DEFAULT_SERVER_FEATURES,
  type ServerFeatures,
  serverFeatures,
} from "../state/serverFeatures.js";
import { settingsTab, showSettings } from "../state/ui.js";
import { SettingsDialog } from "./SettingsDialog.js";

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
      adminExport: false,
    });
  });
});
