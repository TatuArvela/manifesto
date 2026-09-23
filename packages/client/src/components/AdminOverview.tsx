import type { AdminOverviewResponse } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import {
  formatDateTime,
  formatFileSize,
  type MessageKey,
  t,
} from "../i18n/index.js";
import { loadAdminOverview } from "../state/admin.js";

/** The jobs the server runs, by the names it gives them. */
const JOB_NAMES: Record<string, MessageKey> = {
  "trash cleanup": "overview.job.trash",
  "session cleanup": "overview.job.sessions",
  "attachment cleanup": "overview.job.attachments",
  "scheduled backup": "overview.job.backup",
};

function uptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return days > 0
    ? t("overview.uptimeDays", { days: String(days), hours: String(hours) })
    : t("overview.uptimeHours", {
        hours: String(hours),
        minutes: String(minutes),
      });
}

/**
 * The admin view's Overview: what the server holds, per account and in all,
 * and whether its background jobs are running and how they last went.
 */
export function AdminOverview() {
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void loadAdminOverview().then((loaded) => {
      if (loaded) setOverview(loaded);
      else setFailed(true);
    });
  }, []);

  if (!overview) {
    return (
      <p class="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
        {failed ? t("overview.failed") : t("overview.loading")}
      </p>
    );
  }

  const { totals } = overview;
  const tiles: [MessageKey, string][] = [
    ["overview.users", String(totals.users)],
    ["overview.notes", String(totals.notes)],
    ["overview.trashed", String(totals.trashedNotes)],
    ["overview.shares", String(totals.shares)],
    ["overview.images", String(totals.attachments)],
    ["overview.imageBytes", formatFileSize(totals.attachmentBytes)],
    ["overview.versions", String(totals.versions)],
  ];

  return (
    <div class="flex flex-col gap-5">
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        {t("overview.version", { version: overview.version })} ·{" "}
        {uptime(overview.uptimeSeconds)}
      </p>

      <dl class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tiles.map(([label, value]) => (
          <div
            key={label}
            class="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2"
          >
            <dt class="text-xs text-neutral-500 dark:text-neutral-400">
              {t(label)}
            </dt>
            <dd class="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <section>
        <h3 class="text-sm font-semibold mb-2">{t("overview.perUser")}</h3>
        <div class="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800">
          <table class="w-full text-sm">
            <thead class="text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th class="text-left font-medium px-3 py-2">
                  {t("overview.account")}
                </th>
                <th class="text-right font-medium px-3 py-2">
                  {t("overview.notes")}
                </th>
                <th class="text-right font-medium px-3 py-2">
                  {t("overview.images")}
                </th>
                <th class="text-right font-medium px-3 py-2">
                  {t("overview.imageBytes")}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-200 dark:divide-neutral-700 tabular-nums">
              {overview.perUser.map((row) => (
                <tr key={row.user.id}>
                  <td class="px-3 py-1.5 truncate max-w-48">
                    {row.user.username}
                  </td>
                  <td class="px-3 py-1.5 text-right">{row.notes}</td>
                  <td class="px-3 py-1.5 text-right">{row.attachments}</td>
                  <td class="px-3 py-1.5 text-right">
                    {formatFileSize(row.attachmentBytes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 class="text-sm font-semibold mb-2">{t("overview.jobs")}</h3>
        <ul class="rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700 bg-white dark:bg-neutral-800">
          {overview.jobs.map((job) => (
            <li key={job.name} class="px-3 py-2 text-sm">
              <div class="flex flex-wrap justify-between gap-x-3">
                <span class="font-medium">
                  {JOB_NAMES[job.name] ? t(JOB_NAMES[job.name]) : job.name}
                </span>
                <span
                  class={
                    job.lastError
                      ? "text-red-600 dark:text-red-400"
                      : "text-neutral-500 dark:text-neutral-400"
                  }
                >
                  {job.running
                    ? t("overview.jobRunning")
                    : job.lastError
                      ? t("overview.jobFailed")
                      : job.lastFinishedAt
                        ? t("overview.jobOk")
                        : t("overview.jobNever")}
                </span>
              </div>
              <p class="text-xs text-neutral-500 dark:text-neutral-400 break-words">
                {job.lastFinishedAt &&
                  t("overview.jobLastRun", {
                    when: formatDateTime(job.lastFinishedAt),
                    ms: String(job.lastDurationMs ?? 0),
                  })}
                {job.lastError && ` · ${job.lastError}`}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
