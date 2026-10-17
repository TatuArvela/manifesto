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

// What a note's menu holds, for every surface that shows one (the card, the
// read-only view, the editor, the composer); `NoteMenu.tsx` draws it.

export interface NoteMenuOptions {
  /**
   * The editor's live buffer. Sharing, duplicating and exporting read it in
   * preference to the stored note, which lags by the auto-save debounce.
   */
  draft?: { title: string; content: string };
  /** Adds "Version history", only where there is a panel to show. */
  onShowVersions?: (() => void) | undefined;
  /**
   * Adds "Delete checked items". The card rewrites the stored note; the editor
   * has to go through its own document, which in collab mode is the only copy
   * that counts.
   */
  checkedItems?: { present: boolean; remove: () => void };
  /** Adds "Sort items by date", through the same two routes. */
  datedItems?: { present: boolean; sort: () => void };
  /**
   * Called when a row moves the note out of the view it was opened from,
   * archiving, trashing and restoring all do. Surfaces that sit over that view
   * close themselves here.
   */
  onDismiss?: () => void;
  /** Drops "Delete" where the surface offers its own discard instead. */
  omitTrash?: boolean;
}

/**
 * The rows every surface shows for a saved note, in one order. Splitting them
 * three ways is what let the card store unnormalized tags, the read-only view
 * stay open over a note it had just archived, and the editor export a note
 * with its auto-note markers still attached.
 *
 * Grouped by what the reader came to do, most particular first: this note's
 * own tools (its history, its checklist), then sending it
 * somewhere (sharing, a file, a copy), then where it sits (its place on the
 * board, the archive), and Delete last on its own. The rarer rows of a group
 * share a submenu, so the panel opens at nine rows or fewer.
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

  // Sorting and deleting items are changing the note, which someone who can
  // only view it cannot do.
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
  // Sharing with people needs accounts, so a server. An automatic note is
  // rewritten by a plugin in its owner's browser and has nothing to offer
  // anyone else, and a trashed one is on its way out.
  if (isServerMode && !note.readonly) {
    // With sharing off on the server, only to take people off a note it
    // was already shared with.
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
        // The attachments, not the count: a note listed by the server carries
        // an empty `images`, and an export written from that would be a file
        // silently missing its pictures.
        const loaded = await ensureImages(note.id);
        // Null is "could not fetch", not "has none"; writing the file anyway
        // would save a note stripped of the pictures it still has. The file
        // carries the bytes, not references only this server can read.
        const images = loaded && (await inlineImages(loaded));
        if (!images) {
          if (loaded) showError(t("error.exportFailed"));
          return;
        }
        // Auto-note markers are stripped so the export is a static, portable
        // note rather than one that claims a plugin owns it.
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

  // The card of a plugin that reads notes has no copy to make: the copy
  // would be an ordinary note, drawn with the images its card is kept from
  // drawing (see `drawnWithoutImages`).
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

  // The board's manual order, for whoever cannot drag: a keyboard, a screen
  // reader, a switch. Offered only where a drag would work, and only the
  // directions the card can go.
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

  // A recipient's Delete puts the note in their own trash, as the owner's does
  // for theirs. Emptying it from there takes the note out of their notes and
  // leaves it with everyone else.
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
        // Asked before anything moves, and the surface stays put if the
        // answer is no: dismissing first would close the editor over a note
        // the reader has just decided to keep.
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
 * "Checklist items", for sorting and clearing a note's checklist. Shared with
 * the new-note sheet, which has no saved note to build the rest from. Either
 * row is left out when the note has nothing it would act on.
 */
export function checklistSubmenu(actions: {
  checkedItems?: { present: boolean; remove: () => void } | undefined;
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

/** "Download", the note as a file in either format. Shared as above. */
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
