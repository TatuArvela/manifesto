import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { storageConnection } from "../storage/index.js";
import { ApiTokensDialog } from "./ApiTokensDialog.js";

let host: HTMLDivElement;

describe("ApiTokensDialog", () => {
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
    storageConnection.value = { serverUrl: null, token: null };
    render(null, host);
    host.remove();
  });

  it("shows a new token's secret once and lists it by its prefix", async () => {
    const listed = [
      {
        id: "t1",
        name: "Shortcut",
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

    render(<ApiTokensDialog onClose={() => {}} />, host);
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
});
