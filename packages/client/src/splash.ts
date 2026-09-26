/**
 * Takes down the loading screen in index.html once there is something worth
 * showing behind it.
 *
 * That is not the first render. The board renders nothing until the notes
 * are in, so fading on the first frame uncovered a header over an empty page
 * and then dropped every card in at once, some of them re-flowing a moment
 * later as their fonts arrived. The app says when its first screen is really
 * there (`revealApp`), and the fade waits for the fonts that screen asked for
 * and for the frame that paints it.
 *
 * `SPLASH_CAP_MS` after boot it goes regardless: a slow server is better seen
 * arriving than hidden behind a screen that looks stuck.
 */

export const SPLASH_CAP_MS = 2500;

let revealing = false;

/**
 * Starts the fade. Called by whatever puts the first real screen up; every
 * call after the first is a no-op.
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
    // Two frames: the first lays out what just rendered (the masonry grid
    // writes its spans there), the second is the one the fade runs from.
    requestAnimationFrame(() => requestAnimationFrame(() => fade(splash)));
  });
}

/**
 * The element is removed rather than left faded out: it covers the viewport
 * and would otherwise sit over every tap for the life of the page. The timer
 * is what guarantees that, since `transitionend` never fires in a background
 * tab, and not at all under the reduced-motion rule that collapses the fade.
 */
function fade(splash: HTMLElement) {
  splash.dataset.done = "true";
  splash.addEventListener("transitionend", () => splash.remove(), {
    once: true,
  });
  setTimeout(() => splash.remove(), 1000);
}

/** Starts the fade by `SPLASH_CAP_MS` after boot, whatever the app is doing. */
export function capSplash(): void {
  setTimeout(revealApp, Math.max(0, SPLASH_CAP_MS - performance.now()));
}
