/**
 * Puts the saved theme on <html> before the first paint.
 *
 * Everything else about preferences belongs to state/prefs.ts, which owns this
 * key and re-applies the class the moment it loads. This copy exists only
 * because that module is part of the bundle, and the bundle runs after the
 * browser has already painted: without it the loading screen, and then the app
 * behind it, would flash white on the way into a dark theme. It reads the same
 * two things prefs.ts does and writes the same class, so the two cannot
 * disagree.
 *
 * A separate file rather than an inline script because the page's CSP allows
 * scripts from 'self' only, and a blocking one because the whole point is to
 * run before anything is drawn.
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
    // Storage can be unavailable (private mode, blocked site data) or hold
    // something unparseable; an unreadable preference is no preference.
    const raw = localStorage.getItem("manifesto:prefs");
    const saved = raw ? JSON.parse(raw).theme : undefined;
    if (saved === "light" || saved === "dark") mode = saved;
  } catch {}
  if (mode === "dark" || (mode === "system" && prefersDark())) {
    document.documentElement.classList.add("dark");
  }
})();
