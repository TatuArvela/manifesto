import { afterEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "../storage/index.js";
import { downloadAccountExport } from "./accountExport.js";

describe("downloadAccountExport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    storageConnection.value = { serverUrl: null, token: null };
  });

  it("downloads the zip under the name the server gives it", async () => {
    storageConnection.value = {
      serverUrl: "https://notes.example",
      token: "t",
    };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["zip"]), {
        headers: {
          "Content-Disposition":
            'attachment; filename="alice-notes-2026-09-23.zip"',
        },
      }),
    );
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    expect(await downloadAccountExport()).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe("https://notes.example/api/export");
    expect(clicked).toEqual(["alice-notes-2026-09-23.zip"]);

    await downloadAccountExport("u 2");
    expect(fetch.mock.calls[1][0]).toBe(
      "https://notes.example/api/admin/users/u%202/export",
    );
  });

  it("says when it could not", async () => {
    expect(await downloadAccountExport()).toBe(false);
    storageConnection.value = { serverUrl: "", token: "t" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 500 }),
    );
    expect(await downloadAccountExport()).toBe(false);
  });
});
