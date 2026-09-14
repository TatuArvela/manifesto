import { type Note, roleOf } from "@manifesto/shared";
import {
  Archive,
  ArchiveRestore,
  Bell,
  Braces,
  Copy,
  FileText,
  History,
  Link,
  ListX,
  Trash2,
  Undo2,
  UserPlus,
  Users,
} from "lucide-preact";
import type { VNode } from "preact";
import { t } from "../i18n/index.js";
import { buildShareUrl } from "../sharing.js";
import { isServerMode } from "../state/auth.js";
import {
  archiveNote,
  createNote,
  ensureImages,
  restoreNote,
  trashNote,
  unarchiveNote,
} from "../state/index.js";
import { shareDialog } from "../state/sharing.js";
import { showSuccess } from "../state/ui.js";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "../utils/importExport.js";

/**
 * The panel a kebab menu draws itself on. `Dropdown` takes it as `panelClass`;
 * a `CardPopover` wraps `NoteMenu` in a div carrying it.
 */
export const menuPanelClass =
  "bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-48 w-max py-1";

/** One row in that panel. Exported for the rows a surface adds of its own. */
export const menuItemClass =
  "flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer";

export const menuDividerClass =
  "my-1 border-t border-neutral-200 dark:border-neutral-700";

export type NoteMenuItem =
  | {
      kind?: "action";
      id: string;
      icon: VNode;
      label: string;
      onSelect: () => void;
    }
  | { kind: "divider"; id: string };

/**
 * Drops a rule that would sit at either end of the menu or next to another
 * one. Callers build their list by omitting items, and a menu that loses
 * everything below its divider should not keep the divider.
 */
function withoutStrayDividers(items: NoteMenuItem[]): NoteMenuItem[] {
  const kept: NoteMenuItem[] = [];
  for (const item of items) {
    if (item.kind !== "divider") {
      kept.push(item);
      continue;
    }
    if (kept.length === 0) continue;
    if (kept[kept.length - 1].kind === "divider") continue;
    kept.push(item);
  }
  while (kept.length > 0 && kept[kept.length - 1].kind === "divider") {
    kept.pop();
  }
  return kept;
}

/**
 * The rows of a note's kebab menu, without the panel around them. The three
 * surfaces that show one (the card, the editor, the read-only view) mount it
 * in their own popover and each adds rows of its own above these.
 *
 * `onClose` runs after any row that acts, so no row has to remember to close
 * the menu itself.
 */
export function NoteMenu({
  items,
  onClose,
}: {
  items: NoteMenuItem[];
  onClose: () => void;
}) {
  return (
    <>
      {withoutStrayDividers(items).map((item) => {
        if (item.kind === "divider") {
          return <div key={item.id} class={menuDividerClass} />;
        }
        return (
          <button
            key={item.id}
            type="button"
            class={menuItemClass}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </>
  );
}

export interface NoteMenuOptions {
  /**
   * The editor's live buffer. Sharing, duplicating and exporting read it in
   * preference to the stored note, which lags by the auto-save debounce.
   */
  draft?: { title: string; content: string };
  /** Adds "Remind me", only where there is a picker for it to open. */
  onOpenReminder?: () => void;
  /** Adds "Version history", only where there is a panel to show. */
  onShowVersions?: () => void;
  /**
   * Adds "Delete checked items". The card rewrites the stored note; the editor
   * has to go through its own document, which in collab mode is the only copy
   * that counts.
   */
  checkedItems?: { present: boolean; remove: () => void };
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

  if (options.onOpenReminder) {
    items.push({
      id: "reminder",
      icon: <Bell class="w-4 h-4" />,
      label: t("noteMenu.reminder"),
      onSelect: options.onOpenReminder,
    });
  }

  if (options.onShowVersions) {
    items.push({
      id: "versions",
      icon: <History class="w-4 h-4" />,
      label: t("noteMenu.versionHistory"),
      onSelect: options.onShowVersions,
    });
  }

  // Sharing with people needs accounts, so a server. An automatic note is
  // rewritten by a plugin in its owner's browser and has nothing to offer
  // anyone else, and a trashed one is on its way out.
  if (isServerMode && !note.readonly) {
    if (role === "owner" && !note.trashed) {
      items.push({
        id: "share-people",
        icon: <UserPlus class="w-4 h-4" />,
        label: t("noteMenu.shareWithPeople"),
        onSelect: () => {
          shareDialog.value = { noteId: note.id };
        },
      });
    } else if (role !== "owner") {
      items.push({
        id: "people",
        icon: <Users class="w-4 h-4" />,
        label: t("noteMenu.people"),
        onSelect: () => {
          shareDialog.value = { noteId: note.id };
        },
      });
    }
  }

  items.push(
    {
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
    },
    {
      id: "duplicate",
      icon: <Copy class="w-4 h-4" />,
      label: t("noteMenu.duplicate"),
      onSelect: () => {
        createNote({
          title,
          content,
          color: note.color,
          font: note.font,
          tags: [...note.tags],
        });
      },
    },
    {
      id: "export-markdown",
      icon: <FileText class="w-4 h-4" />,
      label: t("noteMenu.exportMarkdown"),
      onSelect: () => downloadNoteAsMarkdown({ title, content }),
    },
    {
      id: "export-json",
      icon: <Braces class="w-4 h-4" />,
      label: t("noteMenu.exportJson"),
      onSelect: async () => {
        // The attachments, not the count: a note listed by the server carries
        // an empty `images`, and an export written from that would be a file
        // silently missing its pictures.
        const images = await ensureImages(note.id);
        // Null is "could not fetch", not "has none"; writing the file anyway
        // would save a note stripped of the pictures it still has.
        if (images === null) return;
        // Auto-note markers are stripped so the export is a static, portable
        // note rather than one that claims a plugin owns it.
        const { readonly: _r, source: _s, imageCount: _c, ...plain } = note;
        downloadNoteAsJson({ ...plain, title, content, images });
      },
    },
    {
      id: "archive",
      icon: note.archived ? (
        <ArchiveRestore class="w-4 h-4" />
      ) : (
        <Archive class="w-4 h-4" />
      ),
      label: note.archived ? t("noteMenu.unarchive") : t("noteMenu.archive"),
      onSelect: () => {
        if (note.archived) {
          unarchiveNote(note.id);
        } else {
          archiveNote(note.id);
        }
        onDismiss?.();
      },
    },
    { kind: "divider", id: "destructive" },
  );

  // Deleting items is changing the note, which someone who can only view it
  // cannot do.
  if (options.checkedItems?.present && role !== "view") {
    const { remove } = options.checkedItems;
    items.push({
      id: "delete-checked",
      icon: <ListX class="w-4 h-4" />,
      label: t("noteMenu.deleteChecked"),
      onSelect: remove,
    });
  }

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
      onSelect: () => {
        if (note.trashed) {
          restoreNote(note.id);
        } else {
          trashNote(note.id);
        }
        onDismiss?.();
      },
    });
  }

  return items;
}
