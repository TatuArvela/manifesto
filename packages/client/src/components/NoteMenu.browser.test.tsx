import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { editingNoteId, notes } from "../state/index.js";
import { NoteCard } from "./NoteCard.js";
import { NoteCardEditor } from "./NoteCardEditor.js";
import { NoteMenu, type NoteMenuItem, noteMenuItems } from "./NoteMenu.js";
import { NoteReadonlyView } from "./NoteReadonlyView.js";

/**
 * Three surfaces used to carry three copies of the same menu, and the copies
 * had drifted: the read-only view stayed open over a note it had just
 * archived, and the card listed Duplicate above Share where the other two had
 * it below. Both are tested below, along with the order they now share.
 */

const NOTE_ID = "01JQZK8V0000000000000MENU";

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    title: "Shopping",
    content: "Milk, eggs, coffee",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

let host: HTMLDivElement;

/** The storage adapter reads notes back on write, so seed both. */
function storeNote(note: Note) {
  notes.value = [note];
  localStorage.setItem("manifesto:notes", JSON.stringify([note]));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  localStorage.clear();
  editingNoteId.value = null;
});

afterEach(() => {
  render(null, host);
  host.remove();
  notes.value = [];
  editingNoteId.value = null;
  localStorage.clear();
});

/**
 * A menu is either a `CardPopover` (mounted only while open) or a `Dropdown`
 * (mounted always, shown as a popover), so "the rows on screen" means the ones
 * inside an open panel.
 */
function openMenuPanel(): HTMLElement {
  const panel =
    document.querySelector<HTMLElement>(".dropdown-panel:popover-open") ??
    document.querySelector<HTMLElement>(".card-popover");
  if (!panel) throw new Error("no menu is open");
  return panel;
}

function menuRows(): string[] {
  return [...openMenuPanel().querySelectorAll("button")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter((text) => text.length > 0);
}

function clickRow(label: string) {
  const button = [...openMenuPanel().querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no menu row reading ${label}`);
  button.click();
}

/** Clicks the kebab of whichever surface is on screen and waits for its rows. */
async function openKebab(root: ParentNode = host) {
  const kebab = [...root.querySelectorAll("button")].find(
    (el) => el.getAttribute("aria-label") === t("noteMenu.moreOptions"),
  );
  if (!kebab) throw new Error("no kebab button");
  kebab.click();
  await vi.waitFor(() => {
    expect(menuRows().length).toBeGreaterThan(0);
  });
}

/** The rows every surface shows, in the order they share. */
const sharedRows = [
  t("noteMenu.shareLink"),
  t("noteMenu.duplicate"),
  t("noteMenu.exportMarkdown"),
  t("noteMenu.exportJson"),
  t("noteMenu.archive"),
];

describe("the note menu across its three surfaces", () => {
  it("gives the card the shared rows in the shared order", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCard note={note} />, host);
    await openKebab();

    expect(menuRows().filter((row) => sharedRows.includes(row))).toEqual(
      sharedRows,
    );
    // The card is the only surface with a reminder picker to open from here.
    expect(menuRows()).toContain(t("noteMenu.reminder"));
    expect(menuRows()).toContain(t("noteMenu.delete"));
  });

  it("gives the read-only view the same rows in the same order", async () => {
    const note = makeNote({ readonly: true });
    storeNote(note);
    render(<NoteReadonlyView note={note} onClose={() => {}} />, host);
    await openKebab();

    expect(menuRows().filter((row) => sharedRows.includes(row))).toEqual(
      sharedRows,
    );
  });

  it("gives the editor the same rows, plus version history", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCardEditor note={note} onClose={() => {}} />, host);
    await openKebab();

    expect(menuRows().filter((row) => sharedRows.includes(row))).toEqual(
      sharedRows,
    );
    expect(menuRows()).toContain(t("noteMenu.versionHistory"));
  });

  it("closes the read-only view when the note is archived from it", async () => {
    // Archiving moves the note out of the view it was opened from. Trashing
    // already closed; archiving did not, so the view stayed up over a note
    // that had left the grid behind it.
    const note = makeNote();
    storeNote(note);
    const onClose = vi.fn();
    render(<NoteReadonlyView note={note} onClose={onClose} />, host);
    await openKebab();

    clickRow(t("noteMenu.archive"));

    await vi.waitFor(() => {
      expect(notes.value[0].archived).toBe(true);
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("a note shared with the user", () => {
  const sharing = (role: "edit" | "view") => ({
    role,
    owner: {
      id: "u-olivia",
      username: "olivia",
      displayName: "Olivia",
      avatarColor: "#ef4444",
    },
    members: [],
  });
  const checkedItems = { present: true, remove: () => {} };
  const ids = (note: Note) =>
    noteMenuItems(note, { checkedItems }).map((item) => item.id);

  it("offers leaving it instead of the trash, which is the owner's", () => {
    expect(ids(makeNote({ sharing: sharing("edit") }))).toEqual(
      expect.arrayContaining(["leave", "delete-checked"]),
    );
    expect(ids(makeNote({ sharing: sharing("edit") }))).not.toContain("trash");
  });

  it("does not offer a viewer to delete checked items", () => {
    expect(ids(makeNote({ sharing: sharing("view") }))).not.toContain(
      "delete-checked",
    );
  });

  it("offers no sharing with people in open mode, which has no accounts", () => {
    expect(ids(makeNote())).not.toContain("share-people");
    expect(ids(makeNote())).toContain("trash");
  });
});

describe("the tag button", () => {
  /** Opens the tag picker from its own button and adds `tag` through it. */
  async function addTagThroughButton(tag: string) {
    const button = [...host.querySelectorAll("button")].find(
      (el) => el.getAttribute("aria-label") === t("noteMenu.tags"),
    );
    if (!button) throw new Error("no tag button");
    button.click();
    const input = await vi.waitFor(() => {
      const field = openMenuPanel().querySelector("input");
      if (!field) throw new Error("no tag field");
      return field;
    });
    input.value = tag;
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    // Let the typed text render before Enter reads it, as it would between
    // real keystrokes.
    await new Promise((resolve) => setTimeout(resolve, 0));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  }

  const surfaces = [
    ["card", (note: Note) => <NoteCard note={note} />],
    [
      "editor",
      (note: Note) => <NoteCardEditor note={note} onClose={() => {}} />,
    ],
    [
      "read-only view",
      (note: Note) => <NoteReadonlyView note={note} onClose={() => {}} />,
    ],
  ] as const;

  for (const [name, surface] of surfaces) {
    it(`adds a tag from the ${name}, keeping the ones it has`, async () => {
      const note = makeNote({ tags: ["home"] });
      storeNote(note);
      render(surface(note), host);

      await addTagThroughButton("Errands ");

      await vi.waitFor(() => {
        expect(notes.value[0].tags).toEqual(["home", "errands"]);
      });
    });
  }

  it("is not a row in the menu any more", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCard note={note} />, host);
    await openKebab();

    expect(menuRows()).not.toContain(t("noteMenu.tags"));
  });
});

describe("NoteMenu dividers", () => {
  const row = (id: string): NoteMenuItem => ({
    id,
    icon: <span />,
    label: id,
    onSelect: () => {},
  });

  const dividersIn = (items: NoteMenuItem[]) => {
    render(<NoteMenu items={items} onClose={() => {}} />, host);
    return host.querySelectorAll("div.border-t").length;
  };

  it("keeps a rule that separates two rows", () => {
    expect(dividersIn([row("a"), { kind: "divider", id: "d" }, row("b")])).toBe(
      1,
    );
  });

  it("drops a rule with nothing under it", () => {
    // What a menu builds when everything below the divider is conditional and
    // none of it applies: a read-only note with no checked items to delete.
    expect(dividersIn([row("a"), { kind: "divider", id: "d" }])).toBe(0);
  });

  it("drops a leading rule and collapses a doubled one", () => {
    expect(
      dividersIn([
        { kind: "divider", id: "d1" },
        row("a"),
        { kind: "divider", id: "d2" },
        { kind: "divider", id: "d3" },
        row("b"),
      ]),
    ).toBe(1);
  });
});
