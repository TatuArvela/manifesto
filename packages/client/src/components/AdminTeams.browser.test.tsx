import type { AdminTeam } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { adminUsers } from "../state/admin.js";
import { locale } from "../state/prefs.js";
import { storageConnection } from "../storage/index.js";
import { AdminTeams } from "./AdminTeams.js";

const SERVER = "http://server.test";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function team(overrides: Partial<AdminTeam>): AdminTeam {
  return {
    id: "t1",
    name: "Design",
    source: "local",
    memberCount: 0,
    members: [],
    createdAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

const fetchMock = vi.fn<typeof fetch>();
let host: HTMLDivElement;

beforeEach(() => {
  locale.value = "en";
  host = document.createElement("div");
  document.body.appendChild(host);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  storageConnection.value = { serverUrl: SERVER, token: "tok" };
  adminUsers.value = [];
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
  adminUsers.value = null;
});

describe("the admin's teams", () => {
  it("lists teams, and leaves a provider's team's members alone", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        teams: [
          team({ id: "t1", name: "Design", memberCount: 2 }),
          team({ id: "t2", name: "eng", source: "oidc", memberCount: 5 }),
        ],
      }),
    );
    render(<AdminTeams />, host);
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Design");
    });
    const rows = [...host.querySelectorAll("li")];
    const editable = (row: Element | undefined) =>
      [...(row?.querySelectorAll("button") ?? [])].some(
        (b) => b.textContent === t("admin.teams.editMembers"),
      );
    expect(editable(rows[0])).toBe(true);
    expect(editable(rows[1])).toBe(false);
    expect(rows[1]?.textContent).toContain(t("admin.teams.fromProvider"));
  });

  it("creates a team by name", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ teams: [] }))
      .mockResolvedValueOnce(json({ team: team({ name: "Ops" }) }, 201));
    render(<AdminTeams />, host);
    await vi.waitFor(() => {
      expect(host.textContent).toContain(t("admin.teams.none"));
    });
    const input = host.querySelector<HTMLInputElement>(
      'input[type="text"]',
    ) as HTMLInputElement;
    input.value = "Ops";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    host.querySelector("form")?.requestSubmit();
    await vi.waitFor(() => {
      expect(host.textContent).toContain("Ops");
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      name: "Ops",
      memberIds: [],
    });
  });
});
