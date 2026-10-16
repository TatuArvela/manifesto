import { type Note, roleOf } from "@manifesto/shared";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Bell,
  Braces,
  CalendarArrowDown,
  ChevronLeft,
  ChevronRight,
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
import type { ComponentChildren, VNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { moveCard } from "../hooks/useBoardShortcuts.js";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useMediaQuery } from "../hooks/useMediaQuery.js";
import { t } from "../i18n/index.js";
import { inlineImages, inlinePreviewImages } from "../state/attachments.js";
import { isServerMode } from "../state/auth.js";
import { drawnWithoutImages } from "../state/autoNotes.js";
import { confirmDeletion } from "../state/confirm.js";
import {
  archiveNote,
  createNote,
  ensureImages,
  noteMoveTarget,
  restoreNote,
  showError,
  trashNote,
  unarchiveNote,
} from "../state/index.js";
import { publicLinksDialog } from "../state/publicLinks.js";
import { serverFeature } from "../state/serverFeatures.js";
import { shareDialog } from "../state/sharing.js";
import { showSuccess } from "../state/ui.js";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "../utils/noteDownload.js";
import { buildShareUrl } from "../utils/shareLink.js";

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

/** A row that does something when chosen. */
export interface NoteMenuAction {
  kind?: "action";
  id: string;
  icon: VNode;
  label: string;
  /**
   * What the row reads when it stands at the top level, where its submenu's
   * name is not there to finish the sentence: "Later" under "Move" is "Move
   * later" on its own. Only a row inside a submenu needs one.
   */
  fullLabel?: string;
  onSelect: () => void;
}

export interface NoteMenuDivider {
  kind: "divider";
  id: string;
}

/**
 * A row that opens a list of its own in place of the menu's, with a row back
 * at its head. One level only: a submenu inside a submenu is a menu nobody
 * can find anything in.
 */
export interface NoteMenuSubmenu {
  kind: "submenu";
  id: string;
  icon: VNode;
  label: string;
  items: (NoteMenuAction | NoteMenuDivider)[];
}

export type NoteMenuItem = NoteMenuAction | NoteMenuDivider | NoteMenuSubmenu;

/**
 * Drops a rule that would sit at either end of the menu or next to another
 * one. Callers build their list by omitting items, and a menu that loses
 * everything below its divider should not keep the divider.
 */
function withoutStrayDividers<T extends { kind?: string }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const item of items) {
    if (item.kind !== "divider") {
      kept.push(item);
      continue;
    }
    if (kept.length === 0) continue;
    if (kept.at(-1)?.kind === "divider") continue;
    kept.push(item);
  }
  while (kept.at(-1)?.kind === "divider") {
    kept.pop();
  }
  return kept;
}

/**
 * The menu as it is drawn. A submenu left with nothing in it goes, and one
 * left with a single row gives way to that row: opening "Move" to find only
 * "Later" in it is a press for nothing. Callers can then build every group
 * the same way and let what applies decide its shape.
 */
export function arrangeMenu(items: NoteMenuItem[]): NoteMenuItem[] {
  const arranged: NoteMenuItem[] = [];
  for (const item of items) {
    if (item.kind !== "submenu") {
      arranged.push(item);
      continue;
    }
    const rows = withoutStrayDividers(item.items);
    const actions = rows.filter(
      (row): row is NoteMenuAction => row.kind !== "divider",
    );
    const [only] = actions;
    if (actions.length > 1) arranged.push({ ...item, items: rows });
    else if (only)
      arranged.push({ ...only, label: only.fullLabel ?? only.label });
  }
  return withoutStrayDividers(arranged);
}

/**
 * Whether submenus open beside the menu, on hover, rather than in its place.
 * A mouse or trackpad can point at a row without pressing it; a finger
 * cannot, and a phone has no room beside the panel for a second one.
 */
const FLYOUT_QUERY = "(hover: hover) and (pointer: fine)";

/** How far a flyout laps over the panel; `.menu-flyout` in popovers.css. */
const FLYOUT_OVERLAP = 10;

/** How long the pointer rests on a row before its submenu opens or goes. */
const HOVER_DELAY_MS = 120;

/**
 * The rows of a note's kebab menu, without the panel around them. The three
 * surfaces that show one (the card, the editor, the read-only view) mount it
 * in their own popover, and the editor puts tools of its own above it
 * (`before`).
 *
 * `onClose` runs after any row that acts, so no row has to remember to close
 * the menu itself. Where there is a pointer that can hover, a submenu opens
 * beside the menu as the pointer rests on its row (or on a press, Enter or
 * the right arrow), on whichever side has room. On a touch screen it opens in
 * place instead: the panel's rows give way to its own under a row back,
 * which Escape also takes. `open` says whether the panel is up, for a surface
 * that keeps the menu mounted while it is closed (a `Dropdown`), so it opens
 * again at the top.
 */
export function NoteMenu({
  items,
  onClose,
  before,
  open = true,
}: {
  items: NoteMenuItem[];
  onClose: () => void;
  before?: ComponentChildren;
  open?: boolean;
}) {
  const flyouts = useMediaQuery(FLYOUT_QUERY);
  const [level, setLevel] = useState<{
    submenuId: string | null;
    /** Which way the rows slide in; none for the menu as it first opens. */
    enter?: "forward" | "back";
  }>({ submenuId: null });
  const { submenuId } = level;
  const rootRef = useRef<HTMLDivElement>(null);
  // Where focus goes once the rows have changed: into the submenu, or back to
  // the row that opened it. The row pressed is gone from the page by then, or
  // (beside the menu) the submenu has only just been drawn.
  const focusNext = useRef<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const arranged = arrangeMenu(items);
  const submenu = arranged.find(
    (item): item is NoteMenuSubmenu =>
      item.kind === "submenu" && item.id === submenuId,
  );

  useLayoutEffect(() => {
    if (open) setLevel({ submenuId: null });
  }, [open]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const enterSubmenu = (item: NoteMenuSubmenu, focus = true) => {
    clearTimeout(hoverTimer.current);
    focusNext.current = focus
      ? (item.items.find((row) => row.kind !== "divider")?.id ?? null)
      : null;
    setLevel({ submenuId: item.id, enter: "forward" });
  };
  const leaveSubmenu = () => {
    clearTimeout(hoverTimer.current);
    focusNext.current = submenuId;
    setLevel({ submenuId: null, enter: "back" });
  };
  /** Waits for the pointer to settle, so passing over rows opens nothing. */
  const afterHover = (run: () => void) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(run, HOVER_DELAY_MS);
  };

  useEscapeStack(submenu !== undefined, leaveSubmenu);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === null) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[data-menu-row="${target}"]`)
      ?.focus();
  }, [submenuId]);

  const actionRow = (item: NoteMenuAction) => (
    <button
      key={item.id}
      type="button"
      class={menuItemClass}
      data-menu-row={item.id}
      onClick={() => {
        item.onSelect();
        onClose();
      }}
    >
      {item.icon}
      {item.label}
    </button>
  );
  const subRows = (rows: NoteMenuSubmenu["items"]) =>
    rows.map((item) =>
      item.kind === "divider" ? (
        <div key={item.id} class={menuDividerClass} />
      ) : (
        actionRow(item)
      ),
    );

  if (submenu && !flyouts) {
    return (
      <div
        ref={rootRef}
        key={submenu.id}
        class="menu-level"
        data-enter={level.enter}
      >
        <button
          type="button"
          class={`${menuItemClass} font-medium`}
          data-menu-row="back"
          aria-label={t("noteMenu.back")}
          onClick={leaveSubmenu}
        >
          <ChevronLeft class="w-4 h-4" />
          {submenu.label}
        </button>
        <div class={menuDividerClass} />
        {subRows(submenu.items)}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      key="top"
      class="menu-level relative"
      data-enter={flyouts ? undefined : level.enter}
    >
      {before}
      {arranged.map((item) => {
        if (item.kind === "divider") {
          return <div key={item.id} class={menuDividerClass} />;
        }
        if (item.kind !== "submenu") {
          return (
            <div
              key={item.id}
              class="contents"
              onPointerEnter={
                flyouts && submenu
                  ? () => afterHover(() => setLevel({ submenuId: null }))
                  : undefined
              }
            >
              {actionRow(item)}
            </div>
          );
        }
        const expanded = flyouts && submenu?.id === item.id;
        return (
          <div key={item.id} class="contents">
            <button
              type="button"
              class={`${menuItemClass}${expanded ? " bg-neutral-100 dark:bg-neutral-700" : ""}`}
              data-menu-row={item.id}
              aria-haspopup="true"
              aria-expanded={flyouts ? expanded : undefined}
              // Opens, never toggles: the pointer has usually opened it by
              // hovering on the way to pressing, and a press that shut it
              // again would undo what was asked for. Focus goes in either way.
              onClick={() => enterSubmenu(item)}
              onPointerEnter={
                flyouts
                  ? () => afterHover(() => enterSubmenu(item, false))
                  : undefined
              }
              onPointerLeave={() => clearTimeout(hoverTimer.current)}
              onKeyDown={(e) => {
                if (flyouts && e.key === "ArrowRight") {
                  e.preventDefault();
                  enterSubmenu(item);
                }
              }}
            >
              {item.icon}
              {item.label}
              <ChevronRight class="w-4 h-4 ml-auto pl-2 box-content opacity-60" />
            </button>
            {expanded && (
              <MenuFlyout
                rowId={item.id}
                rootRef={rootRef}
                onPointerEnter={() => clearTimeout(hoverTimer.current)}
                onBack={leaveSubmenu}
              >
                {subRows(item.items)}
              </MenuFlyout>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A submenu drawn beside the menu, level with the row that opened it. It is
 * placed inside the menu's own box, not portalled: the menu may be in the
 * top layer (a `Dropdown`), and anything outside it would be drawn under it.
 * It goes to the right, or to the left where the right edge of the window is
 * too close, and up as far as it has to so its foot stays on screen.
 */
function MenuFlyout({
  rowId,
  rootRef,
  onPointerEnter,
  onBack,
  children,
}: {
  rowId: string;
  rootRef: preact.RefObject<HTMLDivElement | null>;
  onPointerEnter: () => void;
  onBack: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{
    top: number;
    side: "right" | "left";
  } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const flyout = ref.current;
    const row = root?.querySelector<HTMLElement>(`[data-menu-row="${rowId}"]`);
    if (!root || !flyout || !row) return;
    const rootBox = root.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const { width, height } = flyout.getBoundingClientRect();
    const viewport = document.documentElement;
    const gap = 8;
    const reach = width - FLYOUT_OVERLAP + gap;
    const side =
      rootBox.right + reach <= viewport.clientWidth || rootBox.left - reach < 0
        ? "right"
        : "left";
    // The flyout's first row level with the one that opened it (`py-1` is
    // the panel's 4px), nudged up if its foot would leave the window.
    const wanted = rowBox.top - 4;
    const top = Math.max(
      gap,
      Math.min(wanted, viewport.clientHeight - height - gap),
    );
    setPlace({ top: top - rootBox.top, side });
  }, [rowId, rootRef]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover keeps it open
    <div
      ref={ref}
      class={`menu-flyout absolute ${menuPanelClass}`}
      data-side={place?.side}
      style={{
        top: `${place?.top ?? 0}px`,
        visibility: place ? "visible" : "hidden",
      }}
      onPointerEnter={onPointerEnter}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          onBack();
        }
      }}
    >
      {children}
    </div>
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
 * own tools (a reminder, its history, its checklist), then sending it
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
  const move: NoteMenuAction[] = [];
  if (noteMoveTarget(note.id, -1)) {
    move.push({
      id: "move-earlier",
      icon: <ArrowLeft class="w-4 h-4" />,
      label: t("noteMenu.earlier"),
      fullLabel: t("noteMenu.moveEarlier"),
      onSelect: () => void moveCard(note.id, -1),
    });
  }
  if (noteMoveTarget(note.id, 1)) {
    move.push({
      id: "move-later",
      icon: <ArrowRight class="w-4 h-4" />,
      label: t("noteMenu.later"),
      fullLabel: t("noteMenu.moveLater"),
      onSelect: () => void moveCard(note.id, 1),
    });
  }
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
