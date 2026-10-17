import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "#/styles.css";
import { NoteCardEditor } from "#/components/editor/NoteCardEditor.tsx";
import { t } from "#/i18n/index.ts";
import { notes } from "#/state/notesStore.ts";
import { editingNoteId } from "#/state/ui.ts";
import { NoteCard } from "./NoteCard.tsx";
import { arrangeMenu, NoteMenu, type NoteMenuItem } from "./NoteMenu.tsx";
import { NoteReadonlyView } from "./NoteReadonlyView.tsx";
import { noteMenuItems } from "./noteMenuItems.tsx";

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
  vi.restoreAllMocks();
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

/**
 * The rows every surface shows at the top level, in the order they share. In
 * open mode "Share" holds one row, so that row stands in its place.
 */
const sharedRows = [
  t("noteMenu.shareLink"),
  t("noteMenu.download"),
  t("noteMenu.duplicate"),
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
    // The bell is on the card's toolbar, as on the editor's, not in here.
    expect(menuRows()).not.toContain(t("reminder.set"));
    expect(menuRows()).toContain(t("noteMenu.versionHistory"));
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
      expect(notes.value[0]?.archived).toBe(true);
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
  const datedItems = { present: true, sort: () => {} };
  /** Every row's id, those inside a submenu included. */
  const ids = (note: Note) =>
    noteMenuItems(note, { checkedItems, datedItems }).flatMap((item) =>
      item.kind === "submenu"
        ? [item.id, ...item.items.map((row) => row.id)]
        : [item.id],
    );

  it("offers the recipient's own trash, as for a note of their own", () => {
    expect(ids(makeNote({ sharing: sharing("view") }))).toContain("trash");
    expect(ids(makeNote({ sharing: sharing("edit") }))).toEqual(
      expect.arrayContaining(["trash", "delete-checked"]),
    );
  });

  it("does not offer a viewer to delete checked items", () => {
    expect(ids(makeNote({ sharing: sharing("view") }))).not.toContain(
      "delete-checked",
    );
  });

  it("offers sorting items by date to someone who can edit, not a viewer", () => {
    expect(ids(makeNote({ sharing: sharing("edit") }))).toContain(
      "sort-by-date",
    );
    expect(ids(makeNote({ sharing: sharing("view") }))).not.toContain(
      "sort-by-date",
    );
    expect(
      arrangeMenu(
        noteMenuItems(makeNote(), {
          datedItems: { present: false, sort: () => {} },
        }),
      ).map((item) => item.id),
    ).not.toContain("sort-by-date");
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
        expect(notes.value[0]?.tags).toEqual(["home", "errands"]);
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

describe("submenus", () => {
  const row = (id: string, fullLabel?: string): NoteMenuItem => ({
    id,
    icon: <span />,
    label: id,
    ...(fullLabel ? { fullLabel } : {}),
    onSelect: () => {},
  });
  const sub = (items: NoteMenuItem[]): NoteMenuItem => ({
    kind: "submenu",
    id: "group",
    icon: <span />,
    label: "group",
    items: items.filter((item) => item.kind !== "submenu"),
  });

  it("keeps a submenu of two rows", () => {
    expect(arrangeMenu([sub([row("a"), row("b")])])).toMatchObject([
      { kind: "submenu", id: "group" },
    ]);
  });

  it("puts a submenu's only row in its place, under its full label", () => {
    expect(arrangeMenu([sub([row("later", "Move later")])])).toMatchObject([
      { id: "later", label: "Move later" },
    ]);
  });

  it("drops an empty submenu, and the rule it leaves stranded", () => {
    expect(
      arrangeMenu([
        row("a"),
        { kind: "divider", id: "d" },
        sub([{ kind: "divider", id: "inner" }]),
      ]).map((item) => item.id),
    ).toEqual(["a"]);
  });
});

/**
 * Says whether the pointer can hover, which decides where a submenu opens:
 * beside the menu for a mouse, in its place for a finger.
 */
function pointerCanHover(can: boolean) {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query.includes("hover: hover")
      ? ({
          matches: can,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        } as unknown as MediaQueryList)
      : real(query),
  );
}

function pressKey(key: string) {
  (document.activeElement ?? document).dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true }),
  );
}

describe("a submenu on a touch screen", () => {
  beforeEach(() => pointerCanHover(false));

  it("opens in place and comes back", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCard note={note} />, host);
    await openKebab();

    clickRow(t("noteMenu.download"));
    await vi.waitFor(() => {
      expect(menuRows()).toEqual([
        t("noteMenu.download"),
        t("noteMenu.markdownFile"),
        t("noteMenu.jsonFile"),
      ]);
    });
    // Focus follows into the submenu, or a keyboard is left on nothing.
    expect(document.activeElement?.textContent?.trim()).toBe(
      t("noteMenu.markdownFile"),
    );

    clickRow(t("noteMenu.download"));
    await vi.waitFor(() => {
      expect(menuRows()).toContain(t("noteMenu.archive"));
    });
    expect(document.activeElement?.textContent?.trim()).toBe(
      t("noteMenu.download"),
    );
  });

  it("takes Escape back out before closing the menu", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCard note={note} />, host);
    await openKebab();

    clickRow(t("noteMenu.download"));
    await vi.waitFor(() => {
      expect(menuRows()).toContain(t("noteMenu.jsonFile"));
    });
    pressKey("Escape");

    await vi.waitFor(() => {
      expect(menuRows()).toContain(t("noteMenu.archive"));
    });
  });
});

describe("a submenu with a mouse", () => {
  beforeEach(() => pointerCanHover(true));

  it("opens beside the menu, which keeps its rows", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCard note={note} />, host);
    await openKebab();

    clickRow(t("noteMenu.download"));
    const flyout = await vi.waitFor(() => {
      const el = openMenuPanel().querySelector<HTMLElement>(".menu-flyout");
      if (!el) throw new Error("no flyout");
      return el;
    });
    expect(menuRows()).toContain(t("noteMenu.archive"));
    expect(flyout.textContent).toContain(t("noteMenu.jsonFile"));
    // Beside the panel, lapping 10px over its edge.
    const panel = openMenuPanel().getBoundingClientRect();
    await vi.waitFor(() => {
      const box = flyout.getBoundingClientRect();
      const overlap =
        flyout.dataset.side === "left"
          ? box.right - panel.left
          : panel.right - box.left;
      expect(overlap).toBeCloseTo(10, 0);
    });
    expect(document.activeElement?.textContent?.trim()).toBe(
      t("noteMenu.markdownFile"),
    );
  });

  it("goes with the left arrow, handing focus back to its row", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCard note={note} />, host);
    await openKebab();

    clickRow(t("noteMenu.download"));
    await vi.waitFor(() => {
      expect(document.activeElement?.textContent?.trim()).toBe(
        t("noteMenu.markdownFile"),
      );
    });
    pressKey("ArrowLeft");

    await vi.waitFor(() => {
      expect(document.querySelector(".menu-flyout")).toBeNull();
    });
    expect(document.activeElement?.textContent?.trim()).toBe(
      t("noteMenu.download"),
    );
  });

  it("opens from its row with the right arrow", async () => {
    const note = makeNote();
    storeNote(note);
    render(<NoteCard note={note} />, host);
    await openKebab();

    const row = [...openMenuPanel().querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === t("noteMenu.download"),
    );
    row?.focus();
    pressKey("ArrowRight");

    await vi.waitFor(() => {
      expect(document.querySelector(".menu-flyout")).not.toBeNull();
    });
  });
});
