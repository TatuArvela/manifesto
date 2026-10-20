import type { ApiTokenCreatedResponse, NotesResponse } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defined } from "#/test/defined.ts";
import {
  authHeaders,
  bootTestApp,
  registerTestUser,
  type TestRig,
} from "#/test/setup.ts";

describe("search route", () => {
  let rig: TestRig;

  beforeEach(async () => {
    rig = await bootTestApp();
  });

  afterEach(async () => {
    await rig.close();
  });

  it("does not search for the app, which holds the only key", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const res = await rig.request("/api/v1/search?q=milk", {
      headers: authHeaders(token),
    });
    expect(res.status).toBe(403);
  });

  it("pages a token's results from where the page before left off", async () => {
    const { token } = await registerTestUser(rig, "alice");
    const call = (as: string, method: string, path: string, body?: unknown) =>
      rig.request(path, {
        method,
        headers: authHeaders(as),
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    const minted = await call(token, "POST", "/api/v1/tokens", {
      password: "test-pass-12",
      name: "script",
    });
    const script = defined(
      ((await minted.json()) as ApiTokenCreatedResponse).secret,
    );
    const titles = ["Milk", "Bread", "Oat milk", "MILK again", "Eggs"];
    for (const title of titles) {
      const made = await call(script, "POST", "/api/v1/notes", {
        title,
        content: "",
        color: "default",
        font: "default",
        pinned: false,
        archived: false,
        trashed: false,
        position: 0,
        tags: [],
        images: [],
        linkPreviews: [],
        reminder: null,
      });
      expect(made.status).toBe(201);
    }

    const found: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const at: string = cursor === null ? "" : `&cursor=${cursor}`;
      const res = await call(
        script,
        "GET",
        `/api/v1/search?q=milk&limit=2${at}`,
      );
      expect(res.status).toBe(200);
      const page = (await res.json()) as NotesResponse;
      expect(page.notes.length).toBeLessThanOrEqual(2);
      found.push(...page.notes.map((n) => n.title));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 5);
    // Each match one time. None skipped at the edge of a page.
    expect(found.sort()).toEqual(["MILK again", "Milk", "Oat milk"]);
    expect(pages).toBe(2);
  });

  it("wants a signed-in user", async () => {
    expect((await rig.request("/api/v1/search?q=milk")).status).toBe(401);
  });
});
