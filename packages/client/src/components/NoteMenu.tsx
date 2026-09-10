import type { Note } from "@manifesto/shared";
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
  Tag,
  Trash2,
  Undo2,
} from "lucide-preact";
import type { VNode } from "preact";
import { useEffect, useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { buildShareUrl } from "../sharing.js";
import {
  archiveNote,
  createNote,
  restoreNote,
  trashNote,
  unarchiveNote,
  updateNote,
} from "../state/index.js";
import { showSuccess } from "../state/ui.js";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "../utils/importExport.js";
import { TagPicker } from "./TagPicker.js";

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
  /** The tag list plus its picker, which opens in place and keeps the menu up. */
  | {
      kind: "tags";
      id: string;
      tags: string[];
      onAddTag: (tag: string) => void;
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
 * The rows of a note's kebab menu, without the panel around them — the three
 * surfaces that show one (the card, the editor, the read-only view) mount it
 * in their own popover and each adds rows of its own above these.
 *
 * `onClose` runs after any row that acts, so no row has to remember to close
 * the menu itself.
 */
export function NoteMenu({
  items,
  onClose,
  open = true,
}: {
  items: NoteMenuItem[];
  onClose: () => void;
  /**
   * Whether the menu is on screen. `Dropdown` keeps its panel mounted while
   * closed, so without this the tag picker would still be expanded the next
   * time the menu opened. Surfaces that mount the menu only while it is open
   * can leave it alone.
   */
  open?: boolean;
}) {
  const [showTagPicker, setShowTagPicker] = useState(false);

  useEffect(() => {
    if (!open) setShowTagPicker(false);
  }, [open]);

  return (
    <>
      {withoutStrayDividers(items).map((item) => {
        if (item.kind === "divider") {
          return <div key={item.id} class={menuDividerClass} />;
        }
        if (item.kind === "tags") {
          return (
            <div key={item.id} class="relative">
              <button
                type="button"
                class={menuItemClass}
                onClick={() => setShowTagPicker(!showTagPicker)}
              >
                <Tag class="w-4 h-4" />
                {t("noteMenu.tags")}
              </button>
              {showTagPicker && (
                <TagPicker
                  tags={item.tags}
                  onAddTag={(tag) => {
                    // TagPicker trims and lowercases before it calls back, so
                    // all that is left here is not adding a tag twice.
                    if (!item.tags.includes(tag)) item.onAddTag(tag);
                  }}
                />
              )}
            </div>
          );
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
  /** Adds "Remind me" — only where there is a picker for it to open. */
  onOpenReminder?: () => void;
  /** Adds "Version history" — only where there is a panel to show. */
  onShowVersions?: () => void;
  /**
   * Adds "Delete checked items". The card rewrites the stored note; the editor
   * has to go through its own document, which in collab mode is the only copy
   * that counts.
   */
  checkedItems?: { present: boolean; remove: () => void };
  /**
   * Called when a row moves the note out of the view it was opened from —
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
  const items: NoteMenuItem[] = [
    {
      kind: "tags",
      id: "tags",
      tags: note.tags,
      onAddTag: (tag) => updateNote(note.id, { tags: [...note.tags, tag] }),
    },
  ];

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
      onSelect: () => {
        // Auto-note markers are stripped so the export is a static, portable
        // note rather than one that claims a plugin owns it.
        const { readonly: _r, source: _s, ...plain } = note;
        downloadNoteAsJson({ ...plain, title, content });
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

  if (options.checkedItems?.present) {
    const { remove } = options.checkedItems;
    items.push({
      id: "delete-checked",
      icon: <ListX class="w-4 h-4" />,
      label: t("noteMenu.deleteChecked"),
      onSelect: remove,
    });
  }

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
