import { afterNextPaint } from "#/utils/afterPaint.ts";

/**
 * The class on <body> while a mouse presses a card that can be dragged. It
 * hides the checkboxes of all cards (`styles/note-states.css`), so that the
 * drag ghost has none.
 */
const PRESSED = "note-press-active";

let cancelRelease = () => {};

/** A mouse presses a card that can be dragged. */
export function pressCard() {
  cancelRelease();
  document.body.classList.add(PRESSED);
}

/**
 * The press ends: after the next paint, or `now` at the end of a drag. A click
 * opens the note under it. Thus, the checkboxes of all cards came back in the
 * task of that click, and the browser restyled them before the first frame of
 * the grow. They fade in over 200 ms, so one frame later does not show.
 */
export function releaseCard(now = false) {
  cancelRelease();
  if (now) {
    document.body.classList.remove(PRESSED);
    return;
  }
  cancelRelease = afterNextPaint(() => {
    document.body.classList.remove(PRESSED);
  });
}
