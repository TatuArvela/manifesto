import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
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
import { userEvent } from "vitest/browser";
import { loadEditor } from "#/components/editor/lazyEditor.ts";
import { escapeStackDepth } from "#/hooks/useEscapeStack.ts";
import { t } from "#/i18n/index.ts";
import { notes } from "#/state/notesStore.ts";
import { animations } from "#/state/prefs.ts";
import { activeView, editingNoteId } from "#/state/ui.ts";
import { NoteCard } from "./NoteCard.tsx";

/**
 * Two things meet in this component. `editingNoteId` is the only thing that
 * decides if the modal is open, and the modal is the layer through which Escape
 * must find its way. These tests check both against the real editor, because
 * both failed on the way *out*. A card whose signal a different part cleared
 * stayed on the screen, and a press for the color picker closed the full
 * editor.
 */

const NOTE_ID = "01JQZK8V0000000000000CARD";
const OTHER_ID = "01JQZK8V0000000000000OTHR";

function makeNote(id: string, title: string): Note {
  return {
    id,
    title,
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
  };
}

let host: HTMLDivElement;

const show = (note: Note) => render(<NoteCard note={note} />, host);

/**
 * The modal of the editor is portalled to the body. Thus, look for it there.
 */
const modalIsUp = () => document.querySelector(".milkdown-editor") !== null;

/**
 * The card behind the modal has its own color and menu buttons with the same
 * labels. Thus, each lookup is limited to the editor on top of it.
 */
function editorRoot(): HTMLElement {
  const root = document.querySelector(".milkdown-editor")?.closest("article");
  if (!root) throw new Error("editor is not open");
  return root;
}

/**
 * A real key press, not a synthetic one. The browser dismisses a
 * `popover="auto"` as the *default action* of a trusted Escape. A dispatched
 * event skips that fully, and that is exactly the half of this behavior that is
 * not ours.
 */
const pressEscape = () => userEvent.keyboard("{Escape}");

const buttons = () => [...editorRoot().querySelectorAll("button")];

function clickByLabel(label: string) {
  const button = buttons().find(
    (el) => el.getAttribute("aria-label") === label,
  );
  if (!button) throw new Error(`no button labelled ${label}`);
  button.click();
}

function clickByText(text: string) {
  const button = buttons().find((el) => el.textContent?.includes(text));
  if (!button) throw new Error(`no button reading ${text}`);
  button.click();
}

const MODAL_CLOSE_MS = 150;

/**
 * Waits past the close animation that the card runs before it drops the modal.
 */
const settle = () =>
  new Promise((resolve) => setTimeout(resolve, MODAL_CLOSE_MS + 50));

// The app gets the editor immediately after the board shows (`MainApp`),
// usually long before a note opens. The test gets it here in the same way. If
// not, the first test that opens a note also waits for the full chunk to load.
beforeAll(() => loadEditor());

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(async () => {
  editingNoteId.value = null;
  activeView.value = "active";
  await settle();
  render(null, host);
  host.remove();
  notes.value = [];
  localStorage.clear();
  // The listener plugin of Milkdown serializes after a 200ms debounce, and its
  // serializers read the editor view out of the context while they run. Thus,
  // let it complete, so that it does not fire against a destroyed editor.
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(escapeStackDepth()).toBe(0);
});

function storeNote(note: Note) {
  notes.value = [note];
  localStorage.setItem("manifesto:notes", JSON.stringify([note]));
}

async function openEditor(note: Note) {
  storeNote(note);
  show(note);
  editingNoteId.value = note.id;
  show(note);
  await vi.waitFor(() => {
    expect(modalIsUp()).toBe(true);
  });
}

describe("NoteCard editing modal", () => {
  it("grows the editor out of the card, and keeps it growing", async () => {
    // The effect that opens the modal runs again when the modal opens. Before,
    // that cancelled the grow that it just started: the editor showed in place
    // with no animation.
    const previous = animations.value;
    animations.value = true;
    try {
      const note = makeNote(NOTE_ID, "Shopping");
      storeNote(note);
      show(note);
      editingNoteId.value = note.id;

      const running = await vi.waitFor(() => {
        const panel = document.querySelector(
          '[role="dialog"] .note-sheet-panel',
        );
        if (!panel) throw new Error("modal is not up");
        return panel.getAnimations();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(running).toHaveLength(1);
      expect(running[0]?.playState).toBe("running");
    } finally {
      animations.value = previous;
    }
  });

  it("takes the modal down when editing moves to another note", async () => {
    // A reminder banner, a notification, or a `note:updated` can point
    // `editingNoteId` to a different note without a call to the close handler
    // of this card. The effect had no `else`. Thus, the modal of this card
    // stayed open over a note that nothing edited, with a second modal that
    // opened behind it.
    const note = makeNote(NOTE_ID, "Shopping");
    await openEditor(note);

    editingNoteId.value = OTHER_ID;
    show(note);

    await vi.waitFor(() => {
      expect(modalIsUp()).toBe(false);
    });
  });

  it("closes the modal when the note is archived from the editor", async () => {
    // Archive moves the note out of the view from which it opened. Thus, if the
    // editor stayed open, it would be over a grid that does not contain the
    // note now.
    const note = makeNote(NOTE_ID, "Shopping");
    await openEditor(note);

    clickByLabel(t("noteMenu.moreOptions"));
    await vi.waitFor(() => {
      expect(
        buttons().some((el) => el.textContent?.includes(t("noteMenu.archive"))),
      ).toBe(true);
    });
    clickByText(t("noteMenu.archive"));

    await vi.waitFor(() => {
      expect(editingNoteId.value).toBe(null);
      expect(modalIsUp()).toBe(false);
    });
    expect(notes.value[0]?.archived).toBe(true);
  });

  it("gives Escape to the colour picker, not to the editor under it", async () => {
    // The reported bug: the own dismissal of the picker and the document
    // listener of the editor both fired on one press. Thus, the note also
    // closed.
    const note = makeNote(NOTE_ID, "Shopping");
    await openEditor(note);

    clickByLabel(t("editor.changeColor"));
    await vi.waitFor(() => {
      expect(
        document.querySelector(".dropdown-panel:popover-open"),
      ).toBeTruthy();
    });

    await pressEscape();
    await settle();

    expect(document.querySelector(".dropdown-panel:popover-open")).toBe(null);
    expect(modalIsUp()).toBe(true);
    expect(editingNoteId.value).toBe(NOTE_ID);
  });

  it("opens the note from the keyboard", async () => {
    // Before, cards were only for the mouse: no tab stop, and an Enter handler
    // on an element that nothing could focus.
    const note = makeNote(NOTE_ID, "Shopping");
    storeNote(note);
    show(note);

    const open = host.querySelector<HTMLButtonElement>("[data-card-open]");
    expect(open?.tagName).toBe("BUTTON");
    expect(open?.textContent).toBe("Shopping");

    open?.focus();
    expect(document.activeElement).toBe(open);
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => {
      expect(editingNoteId.value).toBe(NOTE_ID);
    });
  });

  it("is an article around its controls, not a button hiding them", () => {
    // The children of a button are presentational. Thus, a card that was a
    // button hid its pin, color and menu buttons from a screen reader.
    const note = makeNote(NOTE_ID, "Shopping");
    storeNote(note);
    show(note);

    const card = host.querySelector("article");
    expect(card?.getAttribute("role")).toBe(null);
    expect(card?.hasAttribute("tabindex")).toBe(false);
  });

  it("names an untitled card by its first line", () => {
    const note = {
      ...makeNote(NOTE_ID, ""),
      content: "- [ ] Milk\n- [ ] Eggs",
    };
    storeNote(note);
    show(note);

    expect(host.querySelector("[data-card-open]")?.textContent).toBe("Milk");
  });

  it("has nothing to open in the trash, where pressing it does nothing", () => {
    const note = makeNote(NOTE_ID, "Shopping");
    storeNote(note);
    activeView.value = "trash";
    show({ ...note, trashed: true });

    expect(host.querySelector("[data-card-open]")).toBe(null);
  });

  it("keeps Tab inside the editor and gives focus back on close", async () => {
    const note = makeNote(NOTE_ID, "Shopping");
    storeNote(note);
    show(note);
    const card = host.querySelector("[data-card-open]") as HTMLElement;
    card.focus();

    editingNoteId.value = note.id;
    show(note);
    await vi.waitFor(() => {
      expect(modalIsUp()).toBe(true);
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // Click the title field first. A real key press goes to the page, which the
    // test files share. Thus, this makes the presses below go to this document,
    // not to the frame of a different file. The test uses the title because a
    // click on it only focuses it.
    await userEvent.click(
      dialog?.querySelector('input[type="text"]') as HTMLElement,
    );
    // A Tab from anywhere in the dialog must never go out into the grid, where
    // the cards can get focus and still open notes.
    for (let i = 0; i < 40; i++) await userEvent.keyboard("{Tab}");
    expect(dialog?.contains(document.activeElement)).toBe(true);

    editingNoteId.value = null;
    await settle();
    expect(document.activeElement).toBe(card);
  });

  it("closes the editor on Escape once nothing is layered over it", async () => {
    const note = makeNote(NOTE_ID, "Shopping");
    await openEditor(note);

    await pressEscape();

    await vi.waitFor(() => {
      expect(editingNoteId.value).toBe(null);
    });
    await vi.waitFor(() => {
      expect(modalIsUp()).toBe(false);
    });
  });
});

describe("the card's bell", () => {
  it("opens the reminder picker from the toolbar", async () => {
    const note = makeNote(NOTE_ID, "Card");
    storeNote(note);
    show(note);
    const bell = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${t("reminder.set")}"]`,
    );
    expect(bell).not.toBeNull();
    bell?.click();

    await new Promise((resolve) => setTimeout(resolve, 300));
    const open = [
      ...document.querySelectorAll<HTMLElement>(".card-popover"),
    ].filter((el) => el.dataset.leaving !== "true");
    expect(open).toHaveLength(1);
    expect(open[0]?.textContent).toContain(t("reminder.header"));
    await pressEscape();
  });
});

describe("a card's popovers from the keyboard", () => {
  it("takes focus to the current colour and gives it back on Escape", async () => {
    // The panel is portalled to the end of the page, and nothing moved focus
    // into it. Tab from its button went to the next card.
    const note = makeNote(NOTE_ID, "Card");
    storeNote(note);
    show(note);
    const trigger = host.querySelector<HTMLButtonElement>(
      `button[aria-label="${t("noteCard.changeColor")}"]`,
    );
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    trigger?.focus();
    trigger?.click();

    const current = await vi.waitFor(() => {
      const swatch = document.querySelector<HTMLButtonElement>(
        '.card-popover button[aria-pressed="true"]',
      );
      if (!swatch) throw new Error("no current colour");
      return swatch;
    });
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(current);
    });
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");

    await pressEscape();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });
});
