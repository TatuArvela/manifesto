/**
 * Puts the saved theme on <html> before the first paint.
 *
 * state/prefs.ts owns all other parts of the preferences. It owns this key, and
 * applies the class again when it loads. This copy exists only because that
 * module is part of the bundle, and the bundle runs after the browser painted.
 * Without it, the loading screen, and then the app behind it, would show white
 * for a moment before a dark theme. It reads the same two values as prefs.ts,
 * and writes the same class. Thus, the two always agree.
 *
 * It is a separate file, not an inline script, because the CSP of the page
 * permits scripts only from 'self'. It blocks, because it must run before
 * anything is drawn.
 */
(() => {
  const prefersDark = () => {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  };
  let mode = "system";
  try {
    // Storage can be unavailable (private mode, blocked site data), or contain
    // data that does not parse. An unreadable preference is no preference.
    const raw = localStorage.getItem("manifesto:prefs");
    const saved = raw ? JSON.parse(raw).theme : undefined;
    if (saved === "light" || saved === "dark") mode = saved;
  } catch {}
  if (mode === "dark" || (mode === "system" && prefersDark())) {
    document.documentElement.classList.add("dark");
  }
})();
