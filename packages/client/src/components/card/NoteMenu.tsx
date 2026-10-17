import { ChevronLeft, ChevronRight } from "lucide-preact";
import type { ComponentChildren, VNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useMediaQuery } from "#/hooks/useMediaQuery.ts";
import { t } from "#/i18n/index.ts";

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
