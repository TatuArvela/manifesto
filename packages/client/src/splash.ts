/**
 * Removes the loading screen in index.html when there is something useful to
 * show behind it.
 *
 * That is not the first render. The board renders nothing until the notes are
 * in. Thus, a fade on the first frame showed a header over an empty page, and
 * then dropped all cards in at the same time, and some changed their layout a
 * moment later when their fonts arrived. The app tells when its first screen is
 * really there (`revealApp`). The fade waits for the fonts that screen asked
 * for, and for the frame that paints it.
 *
 * `SPLASH_CAP_MS` after start, it goes in all cases. It is better to see a slow
 * server arrive than to hide it behind a screen that looks stuck.
 */

export const SPLASH_CAP_MS = 2500;

let revealing = false;

/**
 * Starts the fade. The code that shows the first real screen calls it. Each
 * call after the first does nothing.
 */
export function revealApp(): void {
  if (revealing) return;
  revealing = true;
  const splash = document.getElementById("splash");
  if (!splash) return;

  const left = Math.max(0, SPLASH_CAP_MS - performance.now());
  const fonts = document.fonts?.ready ?? Promise.resolve();
  void Promise.race([
    fonts,
    new Promise((resolve) => setTimeout(resolve, left)),
  ]).then(() => {
    // Two frames. The first lays out what just rendered (the masonry grid
    // writes its spans there). The fade runs from the second.
    requestAnimationFrame(() => requestAnimationFrame(() => fade(splash)));
  });
}

/**
 * The element is removed, not left faded out. It covers the viewport, and would
 * otherwise be over each tap for the life of the page. The timer makes sure of
 * that, because `transitionend` never fires in a background tab, and does not
 * fire at all under the reduced-motion rule that removes the fade.
 */
function fade(splash: HTMLElement) {
  splash.dataset.done = "true";
  splash.addEventListener("transitionend", () => splash.remove(), {
    once: true,
  });
  setTimeout(() => splash.remove(), 1000);
}

/**
 * Starts the fade at the latest `SPLASH_CAP_MS` after start, whatever the app
 * does.
 */
export function capSplash(): void {
  setTimeout(revealApp, Math.max(0, SPLASH_CAP_MS - performance.now()));
}
