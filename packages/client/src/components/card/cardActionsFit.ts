import { createContext } from "preact";

/** The buttons of a card that can move into its menu, in the row's order. */
export type CardAction =
  | "color"
  | "font"
  | "reminder"
  | "image"
  | "draw"
  | "tags";

/**
 * The width of the cards of one grid, and if the buttons have their phone
 * size. All cards of a grid have one width. Thus, `ReorderableGrid` measures it
 * once, and no card measures itself. `undefined` until it is measured: then
 * each card shows all its buttons.
 */
export interface CardRoom {
  width: number;
  phone: boolean;
}

export const CardRoomContext = createContext<CardRoom | undefined>(undefined);

/** `iconButtonClass`: a 16px icon in `p-1.5`, or `max-sm:p-2.5`. */
const BUTTON_PX = 28;
const PHONE_BUTTON_PX = 36;
/** `gap-1` of the row. */
const GAP_PX = 4;
/** `p-4` and the 1px border of the card, less the `-ml-1.5` of the row. */
const CARD_INSET_PX = 2 * 16 + 2 - 6;
/** `px-2.5` of the row over an image or a link hero. */
const OVERLAY_INSET_PX = 2 * 10;

/**
 * The buttons that do not fit on the row of a card, from the right end. They
 * go into the menu. The menu button itself always stays, after `leading` other
 * buttons that always stay (the badge and refresh of an auto-note).
 */
export function overflowingActions({
  room,
  actions,
  leading,
  overlay,
}: {
  room: CardRoom;
  actions: CardAction[];
  leading: number;
  overlay: boolean;
}): CardAction[] {
  const button = room.phone ? PHONE_BUTTON_PX : BUTTON_PX;
  const inner = room.width - (overlay ? OVERLAY_INSET_PX : CARD_INSET_PX);
  const fit = Math.floor((inner + GAP_PX) / (button + GAP_PX));
  if (leading + actions.length + 1 <= fit) return [];
  return actions.slice(Math.max(0, fit - leading - 1));
}
