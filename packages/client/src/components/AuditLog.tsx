import type { AuditEntry, ShareUser } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import { formatDateTime, type MessageKey, t } from "../i18n/index.js";
import { loadAuditLog } from "../state/admin.js";

const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-60 cursor-pointer";

function nameOf(user: ShareUser | null): string {
  if (!user) return t("audit.nobody");
  // An account deleted since keeps its entries, but not its name.
  return user.username || t("audit.deletedAccount");
}

function detailLine(detail: Record<string, string>): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key}: ${value}`)
    .join(" · ");
}

/**
 * The admin view's Activity section: the audit log, newest first, a page at
 * a time. Who did what to whom, from where, as the server recorded it.
 */
export function AuditLog() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async (before?: string) => {
    setBusy(true);
    const page = await loadAuditLog(before);
    setBusy(false);
    if (!page) {
      setFailed(true);
      if (!before) setEntries([]);
      return;
    }
    setFailed(false);
    setEntries((current) =>
      before ? [...(current ?? []), ...page.entries] : page.entries,
    );
    setNext(page.nextBefore);
  };

  useEffect(() => {
    void load();
  }, []);

  if (entries === null) {
    return (
      <p class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {t("audit.loading")}
      </p>
    );
  }

  return (
    <div class="flex flex-col gap-3">
      {failed && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {t("audit.failed")}
        </p>
      )}
      {entries.length === 0 && !failed ? (
        <p class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t("audit.empty")}
        </p>
      ) : (
        <ul class="rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700 bg-white dark:bg-neutral-800">
          {entries.map((entry) => (
            <li key={entry.id} class="px-4 py-2.5 text-sm">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3">
                <span class="font-medium">
                  {t(`audit.action.${entry.action}` as MessageKey)}
                </span>
                <time
                  class="text-xs text-neutral-500 dark:text-neutral-400"
                  dateTime={entry.at}
                >
                  {formatDateTime(entry.at)}
                </time>
              </div>
              <p class="text-xs text-neutral-600 dark:text-neutral-300 break-words">
                {nameOf(entry.actor)}
                {entry.target && ` → ${nameOf(entry.target)}`}
                {entry.ip && ` · ${t("audit.from", { ip: entry.ip })}`}
                {Object.keys(entry.detail).length > 0 &&
                  ` · ${detailLine(entry.detail)}`}
              </p>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button
          type="button"
          class={`${secondaryButtonClass} self-center`}
          disabled={busy}
          onClick={() => void load(next)}
        >
          {t("audit.more")}
        </button>
      )}
    </div>
  );
}
