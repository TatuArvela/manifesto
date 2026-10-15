import { t } from "../i18n/index.js";
import { confirmDeletion } from "../state/confirm.js";
import {
  activeTag,
  activeView,
  archiveNote,
  moveNoteBy,
  newNoteRequested,
  showShortcuts,
  trashNote,
  unarchiveNote,
} from "../state/index.js";
import { allNotes } from "../state/notesStore.js";
import { boardAnnouncement } from "../state/ui.js";
import {
  cardAfterFocused,
  focusedNoteId,
  moveCardFocus,
} from "../utils/cardFocus.js";
import { useShortcut } from "./useShortcut.js";

/**
 * The shortcuts listed on the `?` sheet, as `[key, message]` pairs, in the
 * order the sheet shows them. Enter is not bound here: a focused card already
 * opens on it.
 */
export const BOARD_SHORTCUTS = [
  ["c", "shortcuts.newNote"],
  ["/", "shortcuts.search"],
  ["j", "shortcuts.next"],
  ["k", "shortcuts.previous"],
  ["J", "shortcuts.moveLater"],
  ["K", "shortcuts.moveEarlier"],
  ["Enter", "shortcuts.open"],
  ["e", "shortcuts.archive"],
  ["#", "shortcuts.trash"],
  ["?", "shortcuts.help"],
] as const;

function focusSearch() {
  const visibleSearch = () =>
    [
      ...document.querySelectorAll<HTMLInputElement>('input[type="search"]'),
    ].find((input) => input.getClientRects().length > 0);
  const input = visibleSearch();
  if (input) {
    input.focus();
    return;
  }
  // On a phone the field is part of the search view, which is not up yet.
  activeView.value = "search";
  requestAnimationFrame(() => visibleSearch()?.focus());
}

/**
 * Moves a card one step in manual order and says where it went, the
 * keyboard's (and the card menu's) way of doing what a drag does. Focus is
 * put back on the card's open button wherever it was focused before, since
 * the move takes its element out of the page and back.
 */
export async function moveCard(id: string, delta: -1 | 1): Promise<void> {
  const hadFocus = focusedNoteId() === id;
  const moved = await moveNoteBy(id, delta);
  if (!moved) return;
  boardAnnouncement.value = t("noteGrid.moved", {
    position: moved.position,
    count: moved.count,
  });
  if (!hadFocus) return;
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(
        `[data-note-id="${CSS.escape(id)}"] [data-card-open]`,
      )
      ?.focus();
  });
}

/** Acts on the focused card, then hands focus to its neighbour. */
async function withFocusedNote(
  act: (id: string) => Promise<boolean | undefined>,
) {
  const id = focusedNoteId();
  if (!id) return;
  const next = cardAfterFocused();
  if (await act(id)) next?.focus();
}

export function useBoardShortcuts(): void {
  useShortcut("c", () => {
    if (activeView.value !== "active") {
      activeView.value = "active";
      activeTag.value = null;
    }
    newNoteRequested.value = true;
  });
  useShortcut("/", focusSearch);
  useShortcut("j", () => moveCardFocus(1));
  useShortcut("k", () => moveCardFocus(-1));
  useShortcut("J", () => {
    const id = focusedNoteId();
    if (id) void moveCard(id, 1);
  });
  useShortcut("K", () => {
    const id = focusedNoteId();
    if (id) void moveCard(id, -1);
  });
  useShortcut("e", () =>
    withFocusedNote(async (id) => {
      const note = allNotes.value.find((n) => n.id === id);
      if (!note || note.trashed) return false;
      return note.archived ? unarchiveNote(id) : archiveNote(id);
    }),
  );
  useShortcut("#", () =>
    withFocusedNote(async (id) => {
      const note = allNotes.value.find((n) => n.id === id);
      if (!note || note.trashed) return false;
      const ok = await confirmDeletion({
        title: t("confirm.trash.title"),
        body: t("confirm.trash.body"),
        confirmLabel: t("confirm.trash.action"),
      });
      return ok ? trashNote(id) : false;
    }),
  );
  useShortcut("?", () => {
    showShortcuts.value = true;
  });
}
