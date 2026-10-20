import { ChevronLeft, ChevronRight } from "lucide-preact";
import type { ComponentChildren, VNode } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useMediaQuery } from "#/hooks/useMediaQuery.ts";
import { t } from "#/i18n/index.ts";

/**
 * The panel on which a kebab menu draws itself. `Dropdown` takes it as
 * `panelClass`. A `CardPopover` wraps `NoteMenu` in a div that has it.
 */
export const menuPanelClass =
  "bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-48 w-max py-1";

/** One row in that panel. Exported for the own rows of a surface. */
export const menuItemClass =
  "flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer";

export const menuDividerClass =
  "my-1 border-t border-neutral-200 dark:border-neutral-700";

/** A row that does something when you select it. */
export interface NoteMenuAction {
  kind?: "action";
  id: string;
  icon: VNode;
  label: string;
  /**
   * The text of the row when it is at the top level, where the name of its
   * submenu is not there to complete the sentence. "Later" under "Move" is
   * "Move later" alone. Only a row inside a submenu needs one.
   */
  fullLabel?: string;
  onSelect: () => void;
}

export interface NoteMenuDivider {
  kind: "divider";
  id: string;
}

/**
 * A row that opens its own list in place of that of the menu, with a back row
 * at its start. Only one level: a submenu inside a submenu is a menu in which
 * nobody can find anything.
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
 * Removes a rule that would be at either end of the menu, or next to a
 * different rule. Callers build their list when they omit items. A menu that
 * loses all items below its divider must not keep the divider.
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
 * The menu as it is drawn. A submenu with nothing in it goes. A submenu with
 * only one row is replaced by that row. To open "Move" and find only "Later" in
 * it is a press for nothing. Thus, callers can build all groups in the same
 * way, and the items that apply decide the shape.
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
 * If submenus open next to the menu, on hover, not in its place. A mouse or
 * trackpad can point at a row without a press. A finger cannot, and a phone has
 * no space next to the panel for a second panel.
 */
const FLYOUT_QUERY = "(hover: hover) and (pointer: fine)";

/** How far a flyout goes over the panel. `.menu-flyout` in popovers.css. */
const FLYOUT_OVERLAP = 10;

/** How long the pointer stays on a row before its submenu opens or goes. */
const HOVER_DELAY_MS = 120;

/**
 * The rows of the kebab menu of a note, without the panel around them. The
 * three surfaces that show one (the card, the editor, the read-only view) mount
 * it in their own popover. The editor puts its own tools above it (`before`).
 *
 * `onClose` runs after each row that acts. Thus, no row has to remember to
 * close the menu itself. Where there is a pointer that can hover, a submenu
 * opens next to the menu when the pointer stays on its row (or on a press,
 * Enter or the right arrow), on the side that has space. On a touch screen, it
 * opens in place: the rows of the panel are replaced by its own rows, under a
 * back row. Escape also goes back. `open` tells if the panel is open, for a
 * surface that keeps the menu mounted while it is closed (a `Dropdown`). Thus,
 * it opens again at the top.
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
    /**
     * The direction from which the rows slide in. None when the menu first
     * opens.
     */
    enter?: "forward" | "back";
  }>({ submenuId: null });
  const { submenuId } = level;
  const rootRef = useRef<HTMLDivElement>(null);
  // Where focus goes after the rows changed: into the submenu, or back to the
  // row that opened it. By then, the pressed row is gone from the page, or
  // (next to the menu) the submenu was just drawn.
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
  /**
   * Waits until the pointer stops. Thus, a pointer that passes over rows opens
   * nothing.
   */
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
              // Opens, never toggles. Usually the pointer already opened it
              // with a hover on its way to the press, and a press that closed
              // it again would undo the request. Focus goes in in both cases.
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
 * A submenu drawn next to the menu, level with the row that opened it. It is
 * inside the own box of the menu, not portalled. The menu can be in the top
 * layer (a `Dropdown`), and all that is outside it would be drawn under it. It
 * goes to the right, or to the left where the right edge of the window is too
 * near. It goes up as far as necessary to keep its bottom on the screen.
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
    // The first row of the flyout is level with the row that opened it (`py-1`
    // is the 4px of the panel). It moves up if its bottom would go out of the
    // window.
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
