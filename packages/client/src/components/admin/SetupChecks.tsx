import type { AdminChecksResponse } from "@manifesto/shared";
import { AlertTriangle, CircleCheck, Info, Mail } from "lucide-preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { formatDateTime, t } from "../../i18n/index.js";
import { loadSetupChecks, sendTestMail } from "../../state/admin.js";
import { type SetupCheckStatus, setupChecks } from "./setupCheckList.js";

const STATUS_ICON: Record<SetupCheckStatus, typeof Info> = {
  ok: CircleCheck,
  info: Info,
  warn: AlertTriangle,
};

const STATUS_CLASS: Record<SetupCheckStatus, string> = {
  ok: "text-green-600 dark:text-green-400",
  info: "text-neutral-500 dark:text-neutral-400",
  warn: "text-amber-600 dark:text-amber-400",
};

/**
 * The overview's setup checks: the settings that go wrong without anything
 * saying so (HTTPS, `APP_URL`, the proxy and `TRUST_PROXY`, backups, mail).
 * Asked for on their own, after the rest of the overview, and again after a
 * test email so its result shows.
 */
export function SetupChecks() {
  const [facts, setFacts] = useState<AdminChecksResponse | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const loaded = await loadSetupChecks();
    if (loaded) setFacts(loaded);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!facts) return null;

  const onTestMail = async () => {
    setSending(true);
    await sendTestMail();
    await load();
    setSending(false);
  };

  return (
    <section>
      <h3 class="text-sm font-semibold mb-2">{t("checks.title")}</h3>
      <ul class="rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700 bg-white dark:bg-neutral-800">
        {setupChecks(facts, window.location).map((check) => {
          const Icon = STATUS_ICON[check.status];
          return (
            <li
              key={check.id}
              class="flex gap-2.5 px-3 py-2 text-sm"
              data-status={check.status}
            >
              <Icon
                class={`w-4 h-4 mt-0.5 shrink-0 ${STATUS_CLASS[check.status]}`}
                aria-label={t(`checks.status.${check.status}`)}
              />
              <div class="min-w-0 flex-1">
                <p class="font-medium">{t(check.title)}</p>
                <p class="text-neutral-600 dark:text-neutral-300 break-words">
                  {t(check.message, {
                    ...check.vars,
                    ...(check.when && { when: formatDateTime(check.when) }),
                  })}
                  {check.docs && (
                    <>
                      {" "}
                      <a
                        class="underline"
                        href={check.docs}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t("checks.docs")}
                      </a>
                    </>
                  )}
                </p>
                {check.id === "mail" && facts.mail && (
                  <button
                    type="button"
                    class="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-60 cursor-pointer"
                    disabled={sending}
                    onClick={() => void onTestMail()}
                  >
                    <Mail class="w-3.5 h-3.5" />
                    {t("checks.mail.test")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
