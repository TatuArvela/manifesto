import { t } from "../i18n/index.js";
import { confirmDeletion } from "../state/confirm.js";
import {
  activeTag,
  activeView,
  archiveNote,
  newNoteRequested,
  showShortcuts,
  trashNote,
  unarchiveNote,
} from "../state/index.js";
import { allNotes } from "../state/notesStore.js";
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
