import {
  type Note,
  NoteColor,
  NoteFont,
  type PublicLink,
  type PublicNote,
} from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerConfirmation } from "../state/confirm.js";
import { notes } from "../state/notesStore.js";
import { locale } from "../state/prefs.js";
import {
  publicLinksDialog,
  publicLinkToken,
  publicLinkUrl,
} from "../state/publicLinks.js";
import { toasts } from "../state/ui.js";
import { storageConnection } from "../storage/index.js";
import { PublicLinksDialogHost } from "./PublicLinksDialog.js";
import { PublicNotePage } from "./PublicNotePage.js";

const SERVER = "http://server.test";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

const shown: PublicNote = {
  title: "Recipe",
  content: "**Flour** and water",
  color: NoteColor.Yellow,
  font: NoteFont.Default,
  images: [],
  linkPreviews: [],
  updatedAt: "2026-04-01T00:00:00.000Z",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeLink(overrides: Partial<PublicLink> = {}): PublicLink {
  return {
    token: TOKEN,
    noteId: "n1",
    mode: "live",
    expiresAt: null,
    hasPassword: false,
    maxViews: null,
    viewCount: 3,
    lastViewedAt: null,
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
  toasts.value = [];
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
  publicLinksDialog.value = null;
  notes.value = [];
});

describe("public link addresses", () => {
  it("round-trip a token through the page's path", () => {
    const path = new URL(publicLinkUrl(TOKEN)).pathname;
    expect(publicLinkToken(path)).toBe(TOKEN);
    expect(publicLinkToken("/tags/p")).toBeNull();
    expect(publicLinkToken("/p/short")).toBeNull();
  });
});

describe("PublicNotePage", () => {
  it("shows the note, rendered and sanitized, and reads it only once", async () => {
    fetchMock.mockResolvedValue(json({ note: shown, access: null }));
    render(<PublicNotePage token={TOKEN} />, host);
    await vi.waitFor(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Recipe");
    });
    expect(host.querySelector("strong")?.textContent).toBe("Flour");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${SERVER}/api/public/${TOKEN}`,
    );
  });

  describe("with a link that can edit", () => {
    const field = <T extends Element>(selector: string) =>
      vi.waitFor(() => {
        const found = host.querySelector<T>(selector);
        expect(found).toBeTruthy();
        return found as T;
      });
    const button = (label: string) =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === label);
    const type = (
      el: HTMLInputElement | HTMLTextAreaElement,
      value: string,
    ) => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const tick = () => new Promise((r) => requestAnimationFrame(r));
    const sent = (call: number) => {
      const [url, init] = fetchMock.mock.calls[call] ?? [];
      return {
        url: String(url),
        method: init?.method,
        ifMatch: (init?.headers as Record<string, string>)?.["If-Match"],
        body: JSON.parse(String(init?.body)) as Record<string, string>,
      };
    };

    async function openEditor() {
      render(<PublicNotePage token={TOKEN} />, host);
      await vi.waitFor(() => expect(button("Edit")).toBeTruthy());
      button("Edit")?.click();
      return await field<HTMLTextAreaElement>("textarea");
    }

    it("offers no editing on a link that only reads", async () => {
      fetchMock.mockResolvedValue(json({ note: shown, access: null }));
      render(<PublicNotePage token={TOKEN} />, host);
      await vi.waitFor(() =>
        expect(host.querySelector("h1")?.textContent).toBe("Recipe"),
      );
      expect(button("Edit")).toBeUndefined();
    });

    it("saves an edit on top of the copy it was shown", async () => {
      const saved = {
        ...shown,
        content: "Flour, water and salt",
        updatedAt: "2026-04-02T00:00:00.000Z",
      };
      fetchMock
        .mockResolvedValueOnce(
          json({ note: shown, access: null, canEdit: true }),
        )
        .mockResolvedValueOnce(
          json({ note: saved, access: null, canEdit: true }),
        );
      const text = await openEditor();
      expect(text.value).toBe(shown.content);
      type(text, "Flour, water and salt");
      await tick();
      host.querySelector("form")?.requestSubmit();

      await vi.waitFor(() =>
        expect(host.textContent).toContain("Flour, water and salt"),
      );
      expect(sent(1)).toEqual({
        url: `${SERVER}/api/public/${TOKEN}`,
        method: "PUT",
        ifMatch: shown.updatedAt,
        body: { title: "Recipe", content: "Flour, water and salt" },
      });
      // Back to reading, and saying so.
      expect(host.querySelector("textarea")).toBeNull();
      expect(host.textContent).toContain("Saved");
    });

    it("replays the edit onto someone else's change, and sends it once more", async () => {
      const base = { ...shown, content: "milk\nbread\neggs" };
      const theirs = {
        ...base,
        content: "milk\nbread\neggs\ncheese",
        updatedAt: "2026-04-02T00:00:00.000Z",
      };
      const merged = {
        ...theirs,
        content: "oat milk\nbread\neggs\ncheese",
        updatedAt: "2026-04-03T00:00:00.000Z",
      };
      fetchMock
        .mockResolvedValueOnce(
          json({ note: base, access: null, canEdit: true }),
        )
        .mockResolvedValueOnce(json({ note: theirs, access: null }, 412))
        .mockResolvedValueOnce(json({ note: merged, access: null }));
      const text = await openEditor();
      type(text, "oat milk\nbread\neggs");
      await tick();
      host.querySelector("form")?.requestSubmit();

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
      expect(sent(2)).toMatchObject({
        ifMatch: theirs.updatedAt,
        body: { content: "oat milk\nbread\neggs\ncheese" },
      });
      await vi.waitFor(() =>
        expect(host.textContent).toContain("together with a change"),
      );
    });

    it("writes nothing over a change it cannot place, and keeps the draft", async () => {
      const theirs = {
        ...shown,
        content: "Something else entirely",
        updatedAt: "2026-04-02T00:00:00.000Z",
      };
      fetchMock
        .mockResolvedValueOnce(
          json({ note: shown, access: null, canEdit: true }),
        )
        .mockResolvedValueOnce(json({ note: theirs, access: null }, 412));
      const text = await openEditor();
      type(text, "**Flour** and oat milk");
      await tick();
      host.querySelector("form")?.requestSubmit();

      await vi.waitFor(() =>
        expect(host.querySelector('[role="alert"]')?.textContent).toContain(
          "changed by someone else",
        ),
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
      // The note as it stands is shown, and the visitor's text is still theirs.
      expect(host.textContent).toContain("Something else entirely");
      expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "**Flour** and oat milk",
      );
    });

    it("keeps the draft when the save does not get through", async () => {
      fetchMock
        .mockResolvedValueOnce(
          json({ note: shown, access: null, canEdit: true }),
        )
        .mockResolvedValueOnce(json({ error: "slow down" }, 429));
      const text = await openEditor();
      type(text, "x");
      await tick();
      host.querySelector("form")?.requestSubmit();
      await vi.waitFor(() =>
        expect(host.querySelector('[role="alert"]')?.textContent).toContain(
          "Too many edits",
        ),
      );
      expect(host.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
        "x",
      );
    });
  });

  it("asks for the password, says when it is wrong, and opens with the right one", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ passwordRequired: true }, 401))
      .mockResolvedValueOnce(json({ error: "Wrong password" }, 403))
      .mockResolvedValueOnce(json({ note: shown, access: "key" }));
    render(<PublicNotePage token={TOKEN} />, host);

    const input = await vi.waitFor(() => {
      const found = host.querySelector<HTMLInputElement>(
        'input[type="password"]',
      );
      expect(found).not.toBeNull();
      return found as HTMLInputElement;
    });
    const submit = async (password: string) => {
      const field = host.querySelector<HTMLInputElement>(
        'input[type="password"]',
      ) as HTMLInputElement;
      field.value = password;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await vi.waitFor(() => {
        expect(
          host.querySelector<HTMLButtonElement>('button[type="submit"]')
            ?.disabled,
        ).toBe(false);
      });
      host.querySelector("form")?.requestSubmit();
    };
    expect(input).toBeDefined();

    await submit("wrong");
    await vi.waitFor(() => {
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "not right",
      );
    });
    await submit("sesame");
    await vi.waitFor(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Recipe");
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      password: "sesame",
    });
  });

  it("says the same thing however a link fails", async () => {
    fetchMock.mockResolvedValue(json({ error: "Link not found" }, 404));
    render(<PublicNotePage token={TOKEN} />, host);
    await vi.waitFor(() => {
      expect(host.textContent).toContain("does not open a note");
    });
  });
});

describe("PublicLinksDialog", () => {
  const note: Note = {
    id: "n1",
    title: "Recipe",
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
    reminder: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };

  it("lists the note's links with their views, and revokes one after asking", async () => {
    notes.value = [note];
    fetchMock
      .mockResolvedValueOnce(json({ links: [makeLink({ maxViews: 5 })] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    publicLinksDialog.value = { noteId: "n1" };
    render(<PublicLinksDialogHost />, host);

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("3 of 5 views");
    });
    const revoke = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Revoke"]',
    );
    revoke?.click();
    await vi.waitFor(() => {
      answerConfirmation(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("DELETE");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `${SERVER}/api/notes/n1/links/${TOKEN}`,
    );
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No public links yet");
    });
  });

  it("offers a link that can edit, for a live link only, and without a view limit", async () => {
    notes.value = [note];
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => {}) },
    });
    fetchMock
      .mockResolvedValueOnce(json({ links: [] }))
      .mockResolvedValueOnce(
        json({ link: makeLink({ canEdit: true, viewCount: 0 }) }, 201),
      );
    publicLinksDialog.value = { noteId: "n1" };
    render(<PublicLinksDialogHost />, host);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No public links yet");
    });
    const form = document.body.querySelector("form") as HTMLFormElement;
    const canEdit = form.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    const views = form.querySelector<HTMLInputElement>(
      'input[type="number"]',
    ) as HTMLInputElement;
    views.value = "5";
    views.dispatchEvent(new Event("input", { bubbles: true }));
    canEdit.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(views.disabled).toBe(true);
    expect(document.body.textContent).toContain("with no account");
    form.requestSubmit();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      mode: "live",
      canEdit: true,
    });
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain("Can edit"),
    );

    // A snapshot has nothing to edit.
    const mode = form.querySelector("select") as HTMLSelectElement;
    mode.value = "snapshot";
    mode.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(canEdit.disabled).toBe(true);
    expect(canEdit.checked).toBe(false);
  });

  it("creates a link with what the form asks for, and copies it", async () => {
    notes.value = [note];
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    fetchMock
      .mockResolvedValueOnce(json({ links: [] }))
      .mockResolvedValueOnce(
        json({ link: makeLink({ mode: "snapshot", viewCount: 0 }) }, 201),
      );
    publicLinksDialog.value = { noteId: "n1" };
    render(<PublicLinksDialogHost />, host);
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No public links yet");
    });

    const [modeSelect, expirySelect] = [
      ...document.body.querySelectorAll<HTMLSelectElement>("form select"),
    ];
    if (!modeSelect || !expirySelect) throw new Error("form not rendered");
    modeSelect.value = "snapshot";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    expirySelect.value = "7";
    expirySelect.dispatchEvent(new Event("change", { bubbles: true }));
    const password = document.body.querySelector<HTMLInputElement>(
      'form input[type="password"]',
    ) as HTMLInputElement;
    password.value = "pw";
    password.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    document.body.querySelector("form")?.requestSubmit();

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      mode: "snapshot",
      expiresInDays: 7,
      password: "pw",
    });
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(publicLinkUrl(TOKEN));
    });
  });
});
