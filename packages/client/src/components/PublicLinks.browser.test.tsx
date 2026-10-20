import {
  type Note,
  NoteColor,
  NoteFont,
  newLinkKey,
  type PublicLink,
  type PublicNote,
  sealSharedFields,
  snapshotKey,
} from "@manifesto/shared";
import { render } from "preact";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { answerConfirmation } from "#/state/confirm.ts";
import { notes } from "#/state/notesStore.ts";
import { locale } from "#/state/prefs.ts";
import {
  publicLinksDialog,
  publicLinkToken,
  publicLinkUrl,
} from "#/state/publicLinks.ts";
import { toasts } from "#/state/ui.ts";
import { storageConnection } from "#/storage/index.ts";
import { PublicNotePage } from "./PublicNotePage.tsx";
import { PublicLinksDialogHost } from "./sharing/PublicLinksDialog.tsx";

const SERVER = "http://server.test";
const TOKEN = "AbCdEfGhIjKlMnOpQrStUv";

/**
 * The key in the address of the link, and the note as the server of a snapshot
 * link gives it: sealed under a key derived from that key. The page has no
 * account. Thus, it really opens this, whatever the other parts of this project
 * skip.
 */
const LINK_KEY = newLinkKey();
let shown: PublicNote;

beforeAll(async () => {
  const key = await snapshotKey(LINK_KEY);
  if (!key) throw new Error("no snapshot key");
  const sealed = await sealSharedFields(key, "n1", {
    title: "Recipe",
    content: "**Flour** and water",
    font: NoteFont.Default,
    images: [],
    linkPreviews: [],
  });
  shown = {
    id: "n1",
    keyVersion: 1,
    format: 1,
    title: sealed.title ?? "",
    content: sealed.content ?? "",
    font: sealed.font ?? "",
    images: sealed.images ?? "",
    linkPreviews: sealed.linkPreviews ?? "",
    updatedAt: "2026-04-01T00:00:00.000Z",
  };
});

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
    sealedLinkKey: "",
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
  history.replaceState(history.state, "", `#k=${LINK_KEY}`);
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
  publicLinksDialog.value = null;
  notes.value = [];
  history.replaceState(history.state, "", location.pathname);
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
    fetchMock.mockResolvedValue(
      json({ note: shown, wrappedKey: null, access: null }),
    );
    render(<PublicNotePage token={TOKEN} />, host);
    await vi.waitFor(() => {
      expect(host.querySelector("h1")?.textContent).toBe("Recipe");
    });
    expect(host.querySelector("strong")?.textContent).toBe("Flour");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${SERVER}/api/v1/public/${TOKEN}`,
    );
  });

  it("asks for the password, says when it is wrong, and opens with the right one", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ passwordRequired: true }, 401))
      .mockResolvedValueOnce(json({ error: "Wrong password" }, 403))
      .mockResolvedValueOnce(
        json({ note: shown, wrappedKey: null, access: "key" }),
      );
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

  it("shows nothing without the key in the address, or with another link's", async () => {
    for (const hash of ["", `#k=${newLinkKey()}`]) {
      history.replaceState(history.state, "", `${location.pathname}${hash}`);
      fetchMock.mockResolvedValue(
        json({ note: shown, wrappedKey: null, access: null }),
      );
      render(<PublicNotePage token={TOKEN} />, host);
      await vi.waitFor(() => {
        expect(host.textContent).toContain("does not open a note");
      });
      expect(host.textContent).not.toContain("Recipe");
      render(null, host);
    }
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
      `${SERVER}/api/v1/notes/n1/links/${TOKEN}`,
    );
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("No public links yet");
    });
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
