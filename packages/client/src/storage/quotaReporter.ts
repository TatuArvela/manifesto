import { t } from "../i18n/index.js";
import { showError } from "../state/ui.js";

// Browser quota exhaustion can fire from multiple call sites within a single
// user action (e.g. NoteCardEditor saving both the note and a version). Show
// the toast once per minute so the user sees one clear message instead of a
// burst.
let lastReportedAt = 0;
const QUIET_PERIOD_MS = 60 * 1000;

export function reportStorageQuotaExceeded(): void {
  const now = Date.now();
  if (now - lastReportedAt < QUIET_PERIOD_MS) return;
  lastReportedAt = now;
  showError(t("storage.quotaExceeded"));
}

/** Test-only — reset the throttle so two tests in the same run can both assert
 *  the toast is emitted. Not intended for production callers. */
export function _resetQuotaReporter(): void {
  lastReportedAt = 0;
}
