import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { AdminOverview } from "./AdminOverview.js";

vi.mock("../state/admin.js", async (original) => ({
  ...(await original<typeof import("../state/admin.js")>()),
  loadAdminOverview: async () => ({
    version: "1.2.3",
    uptimeSeconds: 90_000,
    totals: {
      users: 2,
      notes: 5,
      trashedNotes: 1,
      shares: 0,
      attachments: 3,
      attachmentBytes: 2048,
      versions: 4,
    },
    perUser: [
      {
        user: { id: "u1", username: "alice", displayName: "", avatarColor: "" },
        notes: 5,
        attachments: 3,
        attachmentBytes: 2048,
      },
    ],
    update: {
      latest: "1.3.0",
      url: "https://github.com/TatuArvela/manifesto/releases/tag/v1.3.0",
      checkedAt: "2026-04-01T00:00:00.000Z",
      available: true,
    },
    jobs: [
      {
        name: "trash cleanup",
        intervalMs: 3_600_000,
        lastStartedAt: "2026-04-01T00:00:00.000Z",
        lastFinishedAt: "2026-04-01T00:00:01.000Z",
        lastDurationMs: 12,
        lastError: "disk full",
        running: false,
      },
    ],
  }),
}));

describe("AdminOverview", () => {
  let host: HTMLDivElement;
  afterEach(() => {
    render(null, host);
    host.remove();
  });

  it("shows totals, accounts and how each job last ran", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    render(<AdminOverview />, host);
    await vi.waitFor(() => expect(host.textContent).toContain("alice"));
    expect(host.textContent).toContain(
      t("overview.version", { version: "1.2.3" }),
    );
    expect(host.textContent).toContain(t("overview.job.trash"));
    expect(host.textContent).toContain(t("overview.jobFailed"));
    expect(host.textContent).toContain("disk full");
    expect(host.textContent).toContain(
      t("overview.updateAvailable", { version: "1.3.0" }),
    );
  });
});
