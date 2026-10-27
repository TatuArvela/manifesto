import { isTypingTarget } from "#/hooks/useShortcut.ts";
import { type Tool, toolForKey } from "./DrawingToolbar.tsx";

/** What the keys of the pad do. */
export interface PadKeys {
  tool: Tool;
  chooseTool: (next: Tool) => void;
  /** Keeps the box of the crop. False when there is no box. */
  applyCrop: () => boolean;
  selectAll: () => void;
  deselect: () => void;
  invert: () => void;
  undo: () => void;
  redo: () => void;
}

/**
 * The keys of the pad. Ctrl or Cmd with Z undoes, and with Y or Shift and Z
 * redoes. With A, it selects all, with D it removes the area, and with Shift
 * and I it inverts the area. M and L pick the selection tools, C the crop and
 * Z the zoom, and Enter keeps the box of the crop. Not in a text field:
 * there, the keys type and undo the typing.
 *
 * The pad is a modal dialog, which `useShortcut` leaves alone. Thus, the pad
 * reads the keys that come to it.
 */
export function onPadKey(event: KeyboardEvent, pad: PadKeys): void {
  if (event.altKey || isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (!(event.ctrlKey || event.metaKey)) {
    if (key === "enter" && pad.applyCrop()) {
      event.preventDefault();
      return;
    }
    const next = event.shiftKey ? null : toolForKey(pad.tool, key);
    if (!next) return;
    event.preventDefault();
    pad.chooseTool(next);
    return;
  }
  if (key === "a" && !event.shiftKey) pad.selectAll();
  else if (key === "d" && !event.shiftKey) pad.deselect();
  else if (key === "i" && event.shiftKey) pad.invert();
  else if (key === "y" || (key === "z" && event.shiftKey)) pad.redo();
  else if (key === "z") pad.undo();
  else return;
  event.preventDefault();
}
