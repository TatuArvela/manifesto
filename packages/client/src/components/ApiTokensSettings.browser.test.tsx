import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";

vi.mock("../config.js", async (original) => ({
  ...(await original<typeof import("../config.js")>()),
  resolveServerUrl: () => "https://notes.example",
}));

import { currentUser } from "../state/auth.js";
import {
  DEFAULT_SERVER_FEATURES,
  serverFeatures,
} from "../state/serverFeatures.js";
import { storageConnection } from "../storage/index.js";
import { ApiTokensSettings } from "./ApiTokensSettings.js";

let host: HTMLDivElement;

describe("ApiTokensSettings", () => {
  beforeEach(() => {
    storageConnection.value = {
      serverUrl: "https://notes.example",
      token: "session",
    };
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    serverFeatures.value = DEFAULT_SERVER_FEATURES;
    currentUser.value = null;
    storageConnection.value = { serverUrl: null, token: null };
    render(null, host);
    host.remove();
  });

  it("shows a new token's secret once and lists it by its prefix", async () => {
    const listed = [
      {
        id: "t1",
        name: "Shortcut",
        kind: "api",
        scopes: ["notes:read", "notes:write"],
        prefix: "mfp_abcdef",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
      },
    ];
    let created = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        created = true;
        return Response.json(
          { token: listed[0], secret: "mfp_abcdef-the-secret" },
          { status: 201 },
        );
      }
      return Response.json({ tokens: created ? listed : [] });
    });

    render(<ApiTokensSettings />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.none")),
    );
    const name = host.querySelector<HTMLInputElement>(
      `input[placeholder="${t("tokens.namePlaceholder")}"]`,
    ) as HTMLInputElement;
    name.value = "Shortcut";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    // Let the typed name render, as it has long before anyone can press Create.
    await new Promise((r) => requestAnimationFrame(r));
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLInputElement>(
          `input[aria-label="${t("tokens.secret")}"]`,
        )?.value,
      ).toBe("mfp_abcdef-the-secret"),
    );
    await vi.waitFor(() => expect(host.textContent).toContain("mfp_abcdef..."));
  });

  it("mints an assistant's token and hands over the command that connects it", async () => {
    serverFeatures.value = { ...DEFAULT_SERVER_FEATURES, mcp: true };
    const listed = [
      {
        id: "t2",
        name: "Claude",
        kind: "mcp",
        scopes: ["notes:read"],
        prefix: "mfm_abcdef",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
      },
    ];
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        sent = JSON.parse(init.body as string);
        return Response.json(
          { token: listed[0], secret: "mfm_abcdef-the-secret" },
          { status: 201 },
        );
      }
      return Response.json({ tokens: sent ? listed : [] });
    });

    render(<ApiTokensSettings />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.none")),
    );
    const kind = host.querySelector("select") as HTMLSelectElement;
    kind.value = "mcp";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.readOnly")),
    );
    const readOnly = host.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    readOnly.click();
    const name = host.querySelector<HTMLInputElement>(
      `input[placeholder="${t("tokens.namePlaceholder")}"]`,
    ) as HTMLInputElement;
    name.value = "Claude";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLTextAreaElement>(
          `textarea[aria-label="${t("tokens.mcpCommand")}"]`,
        )?.value,
      ).toMatch(
        /^claude mcp add --transport http \S+ \S*\/api\/mcp --header "Authorization: Bearer mfm_abcdef-the-secret"$/,
      ),
    );
    expect(sent).toMatchObject({
      name: "Claude",
      kind: "mcp",
      scopes: ["notes:read"],
    });
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.mcpReadOnlyBadge")),
    );
  });

  it("mints a calendar token and hands over the feed's address", async () => {
    const listed = [
      {
        id: "t3",
        name: "Phone",
        kind: "calendar",
        scopes: [],
        prefix: "mfc_abcdef",
        createdAt: "2026-01-01T00:00:00.000Z",
        lastUsedAt: null,
        expiresAt: null,
      },
    ];
    let sent: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        sent = JSON.parse(init.body as string);
        return Response.json(
          { token: listed[0], secret: "mfc_abcdef-the-secret" },
          { status: 201 },
        );
      }
      return Response.json({ tokens: sent ? listed : [] });
    });

    render(<ApiTokensSettings />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.none")),
    );
    const kind = host.querySelector("select") as HTMLSelectElement;
    kind.value = "calendar";
    kind.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.calendarHint")),
    );
    const name = host.querySelector<HTMLInputElement>(
      `input[placeholder="${t("tokens.namePlaceholder")}"]`,
    ) as HTMLInputElement;
    name.value = "Phone";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(
        host.querySelector<HTMLInputElement>(
          `input[aria-label="${t("tokens.calendarUrl")}"]`,
        )?.value,
      ).toMatch(/\/api\/calendar\/mfc_abcdef-the-secret\.ics$/),
    );
    expect(sent).toMatchObject({ name: "Phone", kind: "calendar" });
    const subscribe = [...host.querySelectorAll("a")].find(
      (a) => a.textContent === t("tokens.calendarSubscribe"),
    );
    expect(subscribe?.getAttribute("href")).toMatch(/^webcal:\/\//);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.calendarBadge")),
    );
  });

  it("mints a token with the scopes chosen, and names them in the list", async () => {
    let sent: { scopes?: string[] } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        sent = JSON.parse(init.body as string);
        const token = {
          id: "t3",
          name: "Bot",
          kind: "api",
          scopes: sent?.scopes,
          prefix: "mfp_bot",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: null,
          expiresAt: null,
        };
        return Response.json(
          { token, secret: "mfp_bot-secret" },
          { status: 201 },
        );
      }
      return Response.json({
        tokens: sent
          ? [
              {
                id: "t3",
                name: "Bot",
                kind: "api",
                scopes: sent.scopes,
                prefix: "mfp_bot",
                createdAt: "2026-01-01T00:00:00.000Z",
                lastUsedAt: null,
                expiresAt: null,
              },
            ]
          : [],
      });
    });

    render(<ApiTokensSettings />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.none")),
    );
    const access = [...host.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "custom"),
    ) as HTMLSelectElement;
    access.value = "custom";
    access.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.scopeSharing")),
    );
    // Every scope starts ticked; keep reading notes and sharing only.
    for (const label of host.querySelectorAll("fieldset label")) {
      const keep = [t("tokens.scopeNotesRead"), t("tokens.scopeSharing")];
      if (!keep.includes(label.textContent ?? "")) {
        (label.querySelector("input") as HTMLInputElement).click();
      }
    }
    const name = host.querySelector<HTMLInputElement>(
      `input[placeholder="${t("tokens.namePlaceholder")}"]`,
    ) as HTMLInputElement;
    name.value = "Bot";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

    await vi.waitFor(() =>
      expect(sent?.scopes).toEqual(["notes:read", "sharing"]),
    );
    await vi.waitFor(() =>
      expect(host.textContent).toContain(
        `${t("tokens.scopeNotesRead")}, ${t("tokens.scopeSharing")}`,
      ),
    );
  });

  const user = {
    id: "u",
    username: "amy",
    displayName: "Amy",
    avatarColor: "#000",
    email: null,
    isAdmin: false,
  };

  async function submitNamed(name: string) {
    const input = host.querySelector<HTMLInputElement>(
      `input[placeholder="${t("tokens.namePlaceholder")}"]`,
    ) as HTMLInputElement;
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(r));
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  it("asks an account with a password for it, and says when it is wrong", async () => {
    currentUser.value = { ...user, hasPassword: true };
    let sent: { password?: string } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      if (init?.method === "POST") {
        sent = JSON.parse(init.body as string);
        return Response.json(
          { error: "The password is not right", code: "password_incorrect" },
          { status: 403 },
        );
      }
      return Response.json({ tokens: [] });
    });

    render(<ApiTokensSettings />, host);
    const field = await vi.waitFor(() => {
      const input = host.querySelector<HTMLInputElement>(
        'input[type="password"]',
      );
      expect(input).not.toBeNull();
      return input as HTMLInputElement;
    });
    field.value = "not-it-00";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await submitNamed("Script");

    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("confirm.passwordWrong")),
    );
    expect(sent).toMatchObject({ password: "not-it-00" });
  });

  it("sends an account without a password to sign in again", async () => {
    currentUser.value = { ...user, hasPassword: false };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      init?.method === "POST"
        ? Response.json(
            {
              error: "Sign in again to do this",
              code: "reauthentication_required",
            },
            { status: 403 },
          )
        : Response.json({ tokens: [] }),
    );

    render(<ApiTokensSettings />, host);
    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("tokens.none")),
    );
    expect(host.querySelector('input[type="password"]')).toBeNull();
    await submitNamed("Script");

    await vi.waitFor(() =>
      expect(host.textContent).toContain(t("confirm.signInAgain")),
    );
    const link = [...host.querySelectorAll("a")].find(
      (a) => a.textContent === t("confirm.signInAgainLink"),
    );
    expect(link?.getAttribute("href")).toMatch(/\/api\/auth\/login\?reauth=1$/);
  });
});
