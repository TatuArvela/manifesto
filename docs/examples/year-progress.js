// @title Year progress
//
// Example auto-note plugin: year progress.
//
// Shows how far through the calendar year we are — day number and a little
// progress bar. Works in any locale, needs no personal config.
//
// Paste this into Settings → Auto-notes → Paste code, or host it at an HTTPS
// URL and add it as a URL source.
//
// Each plugin receives a `ctx` argument: { today, locale, stdlib }.
//   - today:   "YYYY-MM-DD" for the current day (re-evaluated every minute)
//   - locale:  "en" / "fi" / ...
//   - stdlib:  date helpers (addDays, daysBetween, approxUntil,
//              formatDate, lastOccurrence, ...)
//
// Return a single card or an array of cards. Each card is a plain object:
//   { title, content /* markdown */, color?, font?, tags?, pinned?,
//     position?, key? }

function yearProgress({ today, locale, stdlib }) {
  const { daysBetween, approxUntil } = stdlib;
  const year = today.slice(0, 4);
  const yearStart = `${year}-01-01`;
  const nextYearStart = `${Number(year) + 1}-01-01`;
  const totalDays = daysBetween(yearStart, nextYearStart);
  const dayOfYear = daysBetween(yearStart, today) + 1;
  const ratio = dayOfYear / totalDays;
  const percent = Math.round(ratio * 1000) / 10;
  const filled = Math.round(ratio * 20);
  const bar = "█".repeat(filled) + "░".repeat(20 - filled);
  const fi = locale.startsWith("fi");
  return {
    title: fi ? "Vuoden edistyminen" : "Year progress",
    color: "green",
    content:
      `**${dayOfYear} / ${totalDays}** (${percent}%)\n\n` +
      `\`${bar}\`\n\n` +
      `${fi ? "Uusi vuosi" : "New Year"}: ${approxUntil(nextYearStart, today)}`,
  };
}

// `_default` is the export convention the sandbox looks for.
// Assign a single function for one card, or an array of functions for many.
_default = yearProgress;
