import type { ApiTokenCreatedResponse, NoteCreate } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "../test/setup.js";

const baseNote: NoteCreate = {
  title: "Dentist",
  content: "",
  color: NoteColor.Default,
  font: NoteFont.Default,
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  position: 0,
  tags: [],
  images: [],
  linkPreviews: [],
  reminder: {
    time: "2026-05-01T09:30:00",
    recurrence: "none",
    timezone: "Europe/Helsinki",
  },
};

describe("the reminder feed", () => {
  let rig: TestRig;
  let session: string;

  beforeEach(async () => {
    rig = await bootTestApp();
    session = (await registerTestUser(rig, "olivia")).token;
    await rig.request("/api/notes", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify(baseNote),
    });
  });

  afterEach(async () => {
    await rig.close();
  });

  async function mint(kind: string): Promise<ApiTokenCreatedResponse> {
    const res = await rig.request("/api/tokens", {
      method: "POST",
      headers: authHeaders(session),
      body: JSON.stringify({
        name: "Phone calendar",
        kind,
        password: "test-pass-12",
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as ApiTokenCreatedResponse;
  }

  it("serves the reminders at a calendar token's address", async () => {
    const { secret, token } = await mint("calendar");
    expect(secret.startsWith("mfc_")).toBe(true);
    expect(token).toMatchObject({ kind: "calendar", scopes: [] });

    const res = await rig.request(`/api/calendar/${secret}.ics`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain("SUMMARY:Dentist");
    expect(body).toContain("X-WR-CALNAME:Phone calendar");
    expect(body).toContain("DTSTART;TZID=Europe/Helsinki:20260501T093000");
  });

  it("opens nothing else, and nothing opens it but its own kind", async () => {
    const calendar = await mint("calendar");
    const api = await mint("api");

    // Not a bearer token anywhere.
    const asBearer = await rig.request("/api/notes", {
      headers: authHeaders(calendar.secret),
    });
    expect(asBearer.status).toBe(401);
    // An API token's secret is not a feed address.
    expect((await rig.request(`/api/calendar/${api.secret}.ics`)).status).toBe(
      404,
    );
    expect((await rig.request(`/api/calendar/${calendar.secret}`)).status).toBe(
      404,
    );
    expect((await rig.request("/api/calendar/mfc_made-up.ics")).status).toBe(
      404,
    );
  });

  it("stops when the token is revoked", async () => {
    const { secret, token } = await mint("calendar");
    await rig.request(`/api/tokens/${token.id}`, {
      method: "DELETE",
      headers: authHeaders(session),
    });
    expect((await rig.request(`/api/calendar/${secret}.ics`)).status).toBe(404);
  });
});
