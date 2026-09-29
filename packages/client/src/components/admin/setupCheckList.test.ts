import type { AdminChecksResponse, ProxyFinding } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { type PageAddress, setupChecks } from "./setupCheckList.js";

const PAGE: PageAddress = {
  protocol: "https:",
  hostname: "notes.example",
  origin: "https://notes.example",
};

const FACTS: AdminChecksResponse = {
  appUrl: "https://notes.example",
  trustProxy: true,
  proxy: "overwritten",
  backup: {
    scheduled: true,
    lastFinishedAt: "2026-09-29T03:00:00.000Z",
    lastError: null,
  },
  mail: { lastSentAt: "2026-09-29T08:00:00.000Z", lastFailedAt: null },
};

function check(
  id: string,
  facts: Partial<AdminChecksResponse> = {},
  page: Partial<PageAddress> = {},
) {
  return setupChecks({ ...FACTS, ...facts }, { ...PAGE, ...page }).find(
    (c) => c.id === id,
  );
}

describe("setupChecks", () => {
  it("finds nothing to fix on a server set up as the guide says", () => {
    expect(setupChecks(FACTS, PAGE).map((c) => [c.id, c.status])).toEqual([
      ["https", "ok"],
      ["appUrl", "ok"],
      ["proxy", "ok"],
      ["backup", "ok"],
      ["mail", "ok"],
    ]);
  });

  it("warns about plain HTTP, except on this computer", () => {
    expect(check("https", {}, { protocol: "http:" })?.status).toBe("warn");
    expect(
      check("https", {}, { protocol: "http:", hostname: "localhost" })?.status,
    ).toBe("info");
  });

  it("warns when APP_URL is not the address the admin is on", () => {
    const mismatch = check("appUrl", { appUrl: "https://old.example/" });
    expect(mismatch?.status).toBe("warn");
    expect(mismatch?.vars).toEqual({
      appUrl: "https://old.example/",
      origin: "https://notes.example",
    });
    expect(check("appUrl", { appUrl: null })?.status).toBe("info");
  });

  it("trusts X-Forwarded-For exactly when a proxy replaces it", () => {
    const cases: [ProxyFinding, boolean, string, string][] = [
      ["overwritten", true, "ok", "checks.proxy.trusted"],
      ["overwritten", false, "warn", "checks.proxy.notTrusted"],
      ["appended", true, "warn", "checks.proxy.appendsTrusted"],
      ["appended", false, "info", "checks.proxy.appends"],
      ["untouched", true, "warn", "checks.proxy.bypassed"],
      ["untouched", false, "ok", "checks.proxy.none"],
      ["removed", true, "warn", "checks.proxy.missingHeader"],
      ["removed", false, "ok", "checks.proxy.none"],
    ];
    for (const [proxy, trustProxy, status, message] of cases) {
      const result = check("proxy", { proxy, trustProxy });
      expect([proxy, trustProxy, result?.status, result?.message]).toEqual([
        proxy,
        trustProxy,
        status,
        message,
      ]);
    }
  });

  it("mentions backups that are off, and warns about one that failed", () => {
    const off = { scheduled: false, lastFinishedAt: null, lastError: null };
    expect(check("backup", { backup: off })?.status).toBe("info");
    const failed = {
      scheduled: true,
      lastFinishedAt: "2026-09-29T03:00:00.000Z",
      lastError: "disk full",
    };
    expect(check("backup", { backup: failed })?.status).toBe("warn");
    expect(check("backup", { backup: null })).toBeUndefined();
  });

  it("reads mail by whichever happened last, a send or a failure", () => {
    expect(check("mail", { mail: null })?.message).toBe("checks.mail.off");
    const untested = { lastSentAt: null, lastFailedAt: null };
    expect(check("mail", { mail: untested })?.message).toBe(
      "checks.mail.untested",
    );
    const failedLast = {
      lastSentAt: "2026-09-29T08:00:00.000Z",
      lastFailedAt: "2026-09-29T09:00:00.000Z",
    };
    expect(check("mail", { mail: failedLast })?.status).toBe("warn");
    const recovered = {
      lastSentAt: "2026-09-29T10:00:00.000Z",
      lastFailedAt: "2026-09-29T09:00:00.000Z",
    };
    expect(check("mail", { mail: recovered })?.status).toBe("ok");
  });
});
