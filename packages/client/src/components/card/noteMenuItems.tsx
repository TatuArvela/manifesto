import { type Note, roleOf } from "@manifesto/shared";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  Braces,
  CalendarArrowDown,
  Copy,
  Download,
  FileText,
  Globe,
  History,
  Link,
  ListChecks,
  ListRestart,
  ListX,
  Share2,
  Trash2,
  Undo2,
  UserPlus,
  Users,
} from "lucide-preact";
import { moveCard } from "#/hooks/useBoardShortcuts.ts";
import { t } from "#/i18n/index.ts";
import { isServerMode } from "#/state/account/auth.ts";
import {
  archiveNote,
  noteMoveTarget,
  restoreNote,
  trashNote,
  unarchiveNote,
} from "#/state/actions.ts";
import { inlineImages, inlinePreviewImages } from "#/state/attachments.ts";
import { drawnWithoutImages } from "#/state/autoNotes.ts";
import { confirmDeletion } from "#/state/confirm.ts";
import { createNote, ensureImages } from "#/state/notesStore.ts";
import { publicLinksDialog } from "#/state/publicLinks.ts";
import { serverFeature } from "#/state/serverFeatures.ts";
import { shareDialog } from "#/state/sharing.ts";
import { showError, showSuccess } from "#/state/ui.ts";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "#/utils/noteDownload.ts";
import { buildShareUrl } from "#/utils/shareLink.ts";
import type {
  NoteMenuAction,
  NoteMenuDivider,
  NoteMenuItem,
  NoteMenuSubmenu,
} from "./NoteMenu.tsx";

// The contents of the menu of a note, for each surface that shows one (the
// card, the read-only view, the editor, the composer). `NoteMenu.tsx` draws it.

export interface NoteMenuOptions {
  /**
   * The live buffer of the editor. Share, duplicate and export read it in place
   * of the stored note, which is behind by the debounce of the auto-save.
   */
  draft?: { title: string; content: string };
  /** Adds "Version history", only where there is a panel to show it. */
  onShowVersions?: (() => void) | undefined;
  /**
   * Adds "Delete checked items". The card writes the stored note again. The
   * editor must go through its own document, which in collab mode is the only
   * copy that counts.
   */
  checkedItems?: { present: boolean; remove: () => void; uncheck: () => void };
  /** Adds "Sort items by date", through the same two routes. */
  datedItems?: { present: boolean; sort: () => void };
  /**
   * Called when a row moves the note out of the view from which it opened.
   * Archive, trash and restore all do. Surfaces that are over that view close
   * themselves here.
   */
  onDismiss?: () => void;
  /** Removes "Delete" where the surface offers its own discard in its place. */
  omitTrash?: boolean;
}

/**
 * The rows that each surface shows for a saved note, in one order. When there
 * were three copies, the card stored tags that were not normalized, the
 * read-only view stayed open over a note that it just archived, and the editor
 * exported a note with its auto-note markers still attached.
 *
 * The groups follow what the reader wants to do, most specific first: the own
 * tools of this note (its history, its checklist), then sending it to a
 * different place (sharing, a file, a copy), then its position (its place on
 * the board, the archive), and Delete last, alone. The rarer rows of a group
 * share a submenu. Thus, the panel opens with nine rows or fewer.
 */
export function noteMenuItems(
  note: Note,
  options: NoteMenuOptions = {},
): NoteMenuItem[] {
  const { draft, onDismiss } = options;
  const title = draft?.title ?? note.title;
  const content = draft?.content ?? note.content;
  const role = roleOf(note);
  const items: NoteMenuItem[] = [];

  if (options.onShowVersions) {
    items.push({
      id: "versions",
      icon: <History class="w-4 h-4" />,
      label: t("noteMenu.versionHistory"),
      onSelect: options.onShowVersions,
    });
  }

  // To sort and delete items changes the note. A person who can only view it
  // cannot do that.
  if (role !== "view") {
    items.push(
      checklistSubmenu({
        checkedItems: options.checkedItems,
        datedItems: options.datedItems,
      }),
    );
  }

  items.push({ kind: "divider", id: "send" });

  const share: NoteMenuAction[] = [];
  // Sharing with people needs accounts, thus a server. A plugin writes an
  // automatic note again in the browser of its owner, and it has nothing to
  // offer other persons. A trashed note is on its way out.
  if (isServerMode && !note.readonly) {
    // With sharing off on the server, only to remove people from a note that
    // was already shared with them.
    const shareable =
      serverFeature("sharing") || (note.sharing?.members.length ?? 0) > 0;
    if (role === "owner" && !note.trashed && shareable) {
      share.push({
        id: "share-people",
        icon: <UserPlus class="w-4 h-4" />,
        label: t("noteMenu.shareWithPeople"),
        onSelect: () => {
          shareDialog.value = { noteId: note.id };
        },
      });
    }
    if (role === "owner" && !note.trashed && serverFeature("publicLinks")) {
      share.push({
        id: "public-links",
        icon: <Globe class="w-4 h-4" />,
        label: t("noteMenu.publicLinks"),
        onSelect: () => {
          publicLinksDialog.value = { noteId: note.id };
        },
      });
    }
    if (role !== "owner") {
      share.push({
        id: "people",
        icon: <Users class="w-4 h-4" />,
        label: t("noteMenu.people"),
        onSelect: () => {
          shareDialog.value = { noteId: note.id };
        },
      });
    }
  }
  share.push({
    id: "share",
    icon: <Link class="w-4 h-4" />,
    label: t("noteMenu.shareLink"),
    onSelect: () => {
      const url = buildShareUrl({
        title,
        content,
        color: note.color,
        font: note.font,
        tags: [...note.tags],
      });
      navigator.clipboard.writeText(url);
      showSuccess(t("noteCard.linkCopied"));
    },
  });
  items.push({
    kind: "submenu",
    id: "share-menu",
    icon: <Share2 class="w-4 h-4" />,
    label: t("noteMenu.share"),
    items: share,
  });

  items.push(
    downloadSubmenu({
      markdown: () => downloadNoteAsMarkdown({ title, content }),
      json: async () => {
        // The attachments, not the count. A note that the server listed has an
        // empty `images`, and an export written from that would be a file that
        // silently does not have its pictures.
        const loaded = await ensureImages(note.id);
        // Null means "could not get", not "has none". If the code wrote the
        // file anyway, it would save a note without the pictures that it still
        // has. The file contains the bytes, not references that only this
        // server can read.
        const images = loaded && (await inlineImages(loaded));
        if (!images) {
          if (loaded) showError(t("error.exportFailed"));
          return;
        }
        // The code removes the auto-note markers. Thus, the export is a static,
        // portable note, not one that says that a plugin owns it.
        const { readonly: _r, source: _s, imageCount: _c, ...plain } = note;
        downloadNoteAsJson({
          ...plain,
          title,
          content,
          images,
          linkPreviews: await inlinePreviewImages(plain.linkPreviews),
        });
      },
    }),
  );

  // The card of a plugin that reads notes has no copy to make. The copy would
  // be an ordinary note, drawn with the images that its card does not draw (see
  // `drawnWithoutImages`).
  if (!drawnWithoutImages(note)) {
    items.push({
      id: "duplicate",
      icon: <Copy class="w-4 h-4" />,
      label: t("noteMenu.duplicate"),
      onSelect: () => {
        void createNote({
          title,
          content,
          color: note.color,
          font: note.font,
          tags: [...note.tags],
        });
      },
    });
  }

  items.push({ kind: "divider", id: "place" });

  // The manual order of the board, for a person who cannot drag: a keyboard, a
  // screen reader, a switch. It shows only where a drag would work, and only
  // for the directions that the card can go.
  const moves = [
    [
      "move-start",
      "start",
      <ArrowLeftToLine class="w-4 h-4" />,
      "toStart",
      "moveToStart",
    ],
    [
      "move-earlier",
      -1,
      <ArrowLeft class="w-4 h-4" />,
      "earlier",
      "moveEarlier",
    ],
    ["move-later", 1, <ArrowRight class="w-4 h-4" />, "later", "moveLater"],
    [
      "move-end",
      "end",
      <ArrowRightToLine class="w-4 h-4" />,
      "toEnd",
      "moveToEnd",
    ],
  ] as const;
  const move: NoteMenuAction[] = moves
    .filter(([, step]) => noteMoveTarget(note.id, step))
    .map(([id, step, icon, label, fullLabel]) => ({
      id,
      icon,
      label: t(`noteMenu.${label}`),
      fullLabel: t(`noteMenu.${fullLabel}`),
      onSelect: () => void moveCard(note.id, step),
    }));
  items.push({
    kind: "submenu",
    id: "move-menu",
    icon: <ArrowLeftRight class="w-4 h-4" />,
    label: t("noteMenu.move"),
    items: move,
  });

  items.push({
    id: "archive",
    icon: note.archived ? (
      <ArchiveRestore class="w-4 h-4" />
    ) : (
      <Archive class="w-4 h-4" />
    ),
    label: note.archived ? t("noteMenu.unarchive") : t("noteMenu.archive"),
    onSelect: () => {
      if (note.archived) {
        void unarchiveNote(note.id);
      } else {
        void archiveNote(note.id);
      }
      onDismiss?.();
    },
  });

  items.push({ kind: "divider", id: "destructive" });

  // A Delete by a recipient puts the note in their own trash, as the Delete of
  // the owner does for the owner. When they empty it from there, the note goes
  // out of their notes, and stays with all other persons.
  if (!options.omitTrash) {
    items.push({
      id: "trash",
      icon: note.trashed ? (
        <Undo2 class="w-4 h-4" />
      ) : (
        <Trash2 class="w-4 h-4" />
      ),
      label: note.trashed ? t("noteMenu.undelete") : t("noteMenu.delete"),
      onSelect: async () => {
        if (note.trashed) {
          void restoreNote(note.id);
          onDismiss?.();
          return;
        }
        // Asked before anything moves. If the answer is no, the surface stays.
        // If it closed first, it would close the editor over a note that the
        // reader just decided to keep.
        const ok = await confirmDeletion({
          title: t("confirm.trash.title"),
          body: t("confirm.trash.body"),
          confirmLabel: t("confirm.trash.action"),
        });
        if (!ok) return;
        void trashNote(note.id);
        onDismiss?.();
      },
    });
  }

  return items;
}

/**
 * "Checklist items", to sort and clear the checklist of a note. Shared with the
 * new-note sheet, which has no saved note from which to build the others. The
 * code removes either row when the note has nothing on which it would act.
 */
export function checklistSubmenu(actions: {
  checkedItems?:
    | { present: boolean; remove: () => void; uncheck: () => void }
    | undefined;
  datedItems?: { present: boolean; sort: () => void } | undefined;
}): NoteMenuSubmenu {
  const { checkedItems, datedItems } = actions;
  const items: (NoteMenuAction | NoteMenuDivider)[] = [];
  if (datedItems?.present) {
    items.push({
      id: "sort-by-date",
      icon: <CalendarArrowDown class="w-4 h-4" />,
      label: t("noteMenu.sortByDateShort"),
      fullLabel: t("noteMenu.sortByDate"),
      onSelect: datedItems.sort,
    });
  }
  if (checkedItems?.present) {
    items.push({
      id: "uncheck-all",
      icon: <ListRestart class="w-4 h-4" />,
      label: t("noteMenu.uncheckAllShort"),
      fullLabel: t("noteMenu.uncheckAll"),
      onSelect: checkedItems.uncheck,
    });
  }
  items.push({ kind: "divider", id: "checklist-destructive" });
  if (checkedItems?.present) {
    items.push({
      id: "delete-checked",
      icon: <ListX class="w-4 h-4" />,
      label: t("noteMenu.deleteCheckedShort"),
      fullLabel: t("noteMenu.deleteChecked"),
      onSelect: checkedItems.remove,
    });
  }
  return {
    kind: "submenu",
    id: "checklist-menu",
    icon: <ListChecks class="w-4 h-4" />,
    label: t("noteMenu.checklist"),
    items,
  };
}

/** "Download": the note as a file in either format. Shared as above. */
export function downloadSubmenu(write: {
  markdown: () => void;
  json: () => void | Promise<void>;
}): NoteMenuSubmenu {
  return {
    kind: "submenu",
    id: "download-menu",
    icon: <Download class="w-4 h-4" />,
    label: t("noteMenu.download"),
    items: [
      {
        id: "export-markdown",
        icon: <FileText class="w-4 h-4" />,
        label: t("noteMenu.markdownFile"),
        fullLabel: t("noteMenu.exportMarkdown"),
        onSelect: write.markdown,
      },
      {
        id: "export-json",
        icon: <Braces class="w-4 h-4" />,
        label: t("noteMenu.jsonFile"),
        fullLabel: t("noteMenu.exportJson"),
        onSelect: () => void write.json(),
      },
    ],
  };
}
