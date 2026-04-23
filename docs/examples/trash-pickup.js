// @title Trash pickup
//
// Example auto-note plugin: recurring trash pickup.
//
// Paste this into Settings → Auto-notes → Paste code, or host it at an HTTPS
// URL and add it as a URL source.
//
// Each plugin receives a `ctx` argument: { today, locale, stdlib }.
//   - today:   "YYYY-MM-DD" for the current day (re-evaluated every minute)
//   - locale:  "en" / "fi" / ...
//   - stdlib:  date helpers (addDays, lastOccurrence, relativeDays,
//              approxUntil, formatDate, ...)
//
// Return a single card or an array of cards. Each card is a plain object:
//   { title, content /* markdown */, color?, font?, tags?, pinned?,
//     position?, key? }

// Personal data — the whole point is that this lives outside Manifesto.
const LAST_CONFIRMED_PICKUP = "2024-05-04";
const INTERVAL_DAYS = 42;

function trashPickup({ today, locale, stdlib }) {
  const { formatDate, relativeDays, approxUntil, addDays, lastOccurrence } =
    stdlib;
  const last = lastOccurrence(LAST_CONFIRMED_PICKUP, INTERVAL_DAYS, today);
  const next = addDays(last, INTERVAL_DAYS);
  const fi = locale.startsWith("fi");
  return {
    title: fi ? "Roskien nouto" : "Trash pickup",
    color: "blue",
    tags: [fi ? "koti" : "home"],
    content:
      `**${formatDate(last)}**\n${relativeDays(last, today)}\n\n` +
      `**${formatDate(next)}**\n${approxUntil(next, today)}`,
  };
}

// `_default` is the export convention the sandbox looks for.
// Assign a single function for one card, or an array of functions for many.
_default = trashPickup;
