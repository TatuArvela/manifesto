import {
  type Note,
  NoteColor,
  NoteFont,
  type NoteSharing,
} from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { currentUser, userLookupMode } from "../state/auth.js";
import { notes } from "../state/notesStore.js";
import { locale } from "../state/prefs.js";
import { shareDialog } from "../state/sharing.js";
import { toasts } from "../state/ui.js";
import { storageConnection } from "../storage/index.js";
import { ShareDialogHost } from "./ShareDialog.js";

const SERVER = "http://server.test";

const olivia = {
  id: "u-olivia",
  username: "olivia",
  displayName: "Olivia",
  avatarColor: "#ef4444",
  email: null,
  isAdmin: false,
};

const alice = {
  id: "u-alice",
  username: "alice",
  displayName: "Alice",
  avatarColor: "#3b82f6",
};

function makeNote(sharing?: NoteSharing): Note {
  return {
    id: "n1",
    title: "Groceries",
    content: "- [ ] Milk",
    color: NoteColor.Yellow,
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
    ...(sharing && { sharing }),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  currentUser.value = olivia;
  userLookupMode.value = "search";
  toasts.value = [];
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  storageConnection.value = { serverUrl: null, token: null };
  currentUser.value = null;
  notes.value = [];
  shareDialog.value = null;
});

function dialog(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  if (!found) throw new Error("no dialog");
  return found;
}

function button(label: string): HTMLButtonElement {
  const found = [...dialog().querySelectorAll("button")].find(
    (el) =>
      el.textContent?.trim() === label ||
      el.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the share dialog", () => {
  it("lets the owner find someone as they type and invite them", async () => {
    notes.value = [makeNote()];
    shareDialog.value = { noteId: "n1" };
    render(<ShareDialogHost />, host);

    expect(dialog().textContent).toContain(t("sharing.dialog.nobody"));
    fetchMock.mockResolvedValueOnce(
      json({ users: [{ ...alice, email: "alice@example.com" }] }),
    );
    type(dialog().querySelector("input") as HTMLInputElement, "ali");
    await vi.waitFor(() => {
      expect(dialog().textContent).toContain("alice@example.com");
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${SERVER}/api/users?q=ali`);

    const select = dialog().querySelector("select") as HTMLSelectElement;
    select.value = "view";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    // Rendering is batched; a person cannot click in the same tick either.
    await new Promise((r) => setTimeout(r, 20));

    fetchMock.mockResolvedValueOnce(
      json(
        {
          note: makeNote({
            role: "owner",
            owner: olivia,
            members: [{ ...alice, role: "view", accepted: false }],
          }),
        },
        201,
      ),
    );
    button(t("sharing.add.inviteNamed", { name: "Alice" })).click();
    await vi.waitFor(() => {
      expect(dialog().textContent).toContain(t("sharing.invited"));
    });
    const [, init] = fetchMock.mock.calls[1] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      userId: "u-alice",
      role: "view",
    });
  });

  it("looks up only on request where the server wants a whole name", async () => {
    userLookupMode.value = "exact";
    notes.value = [makeNote()];
    shareDialog.value = { noteId: "n1" };
    render(<ShareDialogHost />, host);

    type(dialog().querySelector("input") as HTMLInputElement, "alic");
    await new Promise((r) => setTimeout(r, 350));
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(json({ users: [] }));
    button(t("sharing.add.find")).click();
    await vi.waitFor(() => {
      expect(dialog().textContent).toContain(t("sharing.add.noExact"));
    });
  });

  it("shows a recipient who has the note, and asks before they leave it", async () => {
    currentUser.value = { ...olivia, ...alice, email: null, isAdmin: false };
    notes.value = [
      makeNote({
        role: "view",
        owner: olivia,
        members: [{ ...alice, role: "view", accepted: true }],
      }),
    ];
    shareDialog.value = { noteId: "n1" };
    render(<ShareDialogHost />, host);

    const text = dialog().textContent ?? "";
    expect(text).toContain(t("sharing.role.owner"));
    expect(text).toContain(t("sharing.you", { name: "Alice" }));
    // No inviting, and no choosing roles, for anyone but the owner.
    expect(dialog().querySelector("select")).toBeNull();
    expect(text).not.toContain(t("sharing.leave.confirm", { name: "Olivia" }));

    button(t("sharing.leave")).click();
    await vi.waitFor(() => {
      expect(dialog().textContent).toContain(
        t("sharing.leave.confirm", { name: "Olivia" }),
      );
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const leave = [...dialog().querySelectorAll("button")].filter(
      (el) => el.textContent?.trim() === t("sharing.leave"),
    );
    leave[0]?.click();
    await vi.waitFor(() => {
      expect(notes.value).toEqual([]);
    });
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("DELETE");
    // The note is gone, and the dialog with it.
    await vi.waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });
});
