/**
 * The part of the page the reader can actually see, published as CSS
 * variables on <html> for the phone's full-screen sheets (the open note, the
 * composer).
 *
 * On a phone the on-screen keyboard shrinks only the visual viewport, in iOS
 * Safari and, by default, in Chrome for Android. A `fixed inset-0` sheet is
 * sized to the layout viewport, which stays the whole screen, so its bottom
 * toolbar sat behind the keyboard, and the browser panned the page to keep
 * the caret in view, sliding the sheet's top off the screen with it. A sheet
 * that follows these variables is always exactly the visible area, with its
 * toolbar on the keyboard.
 *
 * - `--vv-top`: how far the visible area is scrolled into the layout viewport,
 *   which is where a `fixed` element has to start to be at its top.
 * - `--vv-height`: its height.
 * - `keyboard-open` on <html>: the visible area is much shorter than the
 *   window, which only the keyboard does. The home-indicator padding a sheet
 *   keeps at its foot is then a gap above the keys, so it goes.
 */

/** Less than this is the browser's own bars coming and going, not a keyboard. */
const KEYBOARD_MIN_PX = 120;

export function trackVisualViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  let frame = 0;

  const publish = () => {
    frame = 0;
    root.style.setProperty("--vv-top", `${viewport.offsetTop}px`);
    root.style.setProperty("--vv-height", `${viewport.height}px`);
    root.classList.toggle(
      "keyboard-open",
      window.innerHeight - viewport.height * viewport.scale > KEYBOARD_MIN_PX,
    );
  };
  // Both fire many times a frame while the keyboard slides.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(publish);
  };

  publish();
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
  };
}
