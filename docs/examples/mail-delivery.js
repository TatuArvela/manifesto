// @title Mail delivery
//
// Example auto-note plugin: Finnish postal mail delivery schedule.
//
// The Finnish postal service delivers on alternating-week patterns:
//   - Even weeks: Monday, Wednesday, Friday
//   - Odd weeks:  Tuesday, Thursday
//
// Paste this into Settings → Auto-notes → Paste code, or host it at an HTTPS
// URL and add it as a URL source.

function getWeekNumber(date) {
  const firstDayOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const pastDaysOfYear =
    (date.getTime() - firstDayOfYear.getTime()) / 86400000;
  return Math.ceil((pastDaysOfYear + firstDayOfYear.getUTCDay() + 1) / 7);
}

function isDeliveryDay(date, isEvenWeek) {
  const day = date.getUTCDay();
  return isEvenWeek
    ? day === 1 || day === 3 || day === 5
    : day === 2 || day === 4;
}

function findDelivery(todayIso, isNext) {
  const MS = 24 * 60 * 60 * 1000;
  const step = isNext ? 1 : -1;
  const today = new Date(todayIso);
  let d = new Date(today.getTime() + (isNext ? MS : 0));
  let isEven = getWeekNumber(d) % 2 === 0;
  while (!isDeliveryDay(d, isEven) || (isNext && d <= today)) {
    d = new Date(d.getTime() + step * MS);
    isEven = getWeekNumber(d) % 2 === 0;
  }
  return d.toISOString().slice(0, 10);
}

function mailDelivery({ today, locale, stdlib }) {
  const { formatDate, relativeDays, approxUntil } = stdlib;
  const last = findDelivery(today, false);
  const next = findDelivery(today, true);
  const fi = locale.startsWith("fi");
  return {
    title: fi ? "Postin jakelu" : "Mail delivery",
    color: "orange",
    tags: [fi ? "koti" : "home"],
    content:
      `**${formatDate(last)}**\n${relativeDays(last, today)}\n\n` +
      `**${formatDate(next)}**\n${approxUntil(next, today)}`,
  };
}

_default = mailDelivery;
