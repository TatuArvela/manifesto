import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { escapeStackDepth } from "../hooks/useEscapeStack.js";
import { t } from "../i18n/index.js";
import {
  activeView,
  animations,
  editingNoteId,
  notes,
} from "../state/index.js";
import { NoteCard } from "./NoteCard.js";

/**
 * Two things meet in this component: `editingNoteId` is the only thing that
 * decides whether the modal is up, and the modal is the layer Escape has to
 * find its way through. Both are tested here against the real editor, because
 * both used to fail on the way *out*: a card whose signal was cleared by
 * something else stayed on screen, and a press meant for the colour picker
 * closed the whole editor.
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

/** The editor's modal is portalled to the body, so look for it there. */
const modalIsUp = () => document.querySelector(".milkdown-editor") !== null;

/**
 * The card behind the modal carries its own colour and menu buttons with the
 * same labels, so every lookup is scoped to the editor that is on top of it.
 */
function editorRoot(): HTMLElement {
  const root = document.querySelector(".milkdown-editor")?.closest("article");
  if (!root) throw new Error("editor is not open");
  return root;
}

/**
 * A real key press, not a synthesised one: the browser dismisses a
 * `popover="auto"` as the *default action* of a trusted Escape, and a
 * dispatched event skips that entirely, which is exactly the half of this
 * behaviour that is not ours.
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

/** Waits past the close animation the card runs before it drops the modal. */
const settle = () =>
  new Promise((resolve) => setTimeout(resolve, MODAL_CLOSE_MS + 50));

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
  // Milkdown's listener plugin serializes on a 200ms debounce and its
  // serializers read the editor view out of the context as they run, so let it
  // drain rather than firing against a destroyed editor.
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
    // The effect that opens the modal runs again as the modal comes up, and
    // once cancelled the grow it had just started: the editor appeared in
    // place with no animation at all.
    const previous = animations.value;
    animations.value = true;
    try {
      const note = makeNote(NOTE_ID, "Shopping");
      storeNote(note);
      show(note);
      editingNoteId.value = note.id;

      const running = await vi.waitFor(() => {
        const panel = document.querySelector('[role="dialog"] > div');
        if (!panel) throw new Error("modal is not up");
        return panel.getAnimations();
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));

      expect(running).toHaveLength(1);
      expect(running[0].playState).toBe("running");
    } finally {
      animations.value = previous;
    }
  });

  it("takes the modal down when editing moves to another note", async () => {
    // A reminder banner, a notification, or a `note:updated` can point
    // `editingNoteId` somewhere else without ever calling this card's close
    // handler. The effect had no `else`, so this card's modal stayed up over a
    // note nothing was editing, with a second modal opening behind it.
    const note = makeNote(NOTE_ID, "Shopping");
    await openEditor(note);

    editingNoteId.value = OTHER_ID;
    show(note);

    await vi.waitFor(() => {
      expect(modalIsUp()).toBe(false);
    });
  });

  it("closes the modal when the note is archived from the editor", async () => {
    // Archiving moves the note out of the view it was opened from, so leaving
    // the editor up strands it over a grid the note is no longer in.
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
    expect(notes.value[0].archived).toBe(true);
  });

  it("gives Escape to the colour picker, not to the editor under it", async () => {
    // The reported bug: both the picker's own dismissal and the editor's
    // document listener fired on one press, so the note closed too.
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
    // Cards were mouse-only: no tab stop, and an Enter handler on an element
    // nothing could focus.
    const note = makeNote(NOTE_ID, "Shopping");
    storeNote(note);
    show(note);

    const card = host.querySelector("article");
    expect(card?.getAttribute("role")).toBe("button");
    expect(card?.tabIndex).toBe(0);

    card?.focus();
    expect(document.activeElement).toBe(card);
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => {
      expect(editingNoteId.value).toBe(NOTE_ID);
    });
  });

  it("is not a button in the trash, where pressing it does nothing", () => {
    const note = makeNote(NOTE_ID, "Shopping");
    storeNote(note);
    activeView.value = "trash";
    show({ ...note, trashed: true });

    const card = host.querySelector("article");
    expect(card?.getAttribute("role")).toBe(null);
    expect(card?.tabIndex).toBe(-1);
  });

  it("keeps Tab inside the editor and gives focus back on close", async () => {
    const note = makeNote(NOTE_ID, "Shopping");
    storeNote(note);
    show(note);
    const card = host.querySelector("article") as HTMLElement;
    card.focus();

    editingNoteId.value = note.id;
    show(note);
    await vi.waitFor(() => {
      expect(modalIsUp()).toBe(true);
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    // Click the title field first: a real key press goes to the page, which
    // test files share, so this is what makes the presses below land in this
    // document rather than another file's frame. The title is chosen because
    // clicking it does nothing but focus it.
    await userEvent.click(
      dialog?.querySelector('input[type="text"]') as HTMLElement,
    );
    // Tab from anywhere in the dialog must never walk out into the grid, where
    // the cards are focusable and still open notes.
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
