import { AuditLog } from "#/components/admin/AuditLog.tsx";
import { t } from "#/i18n/index.ts";
import { loadAccountActivity } from "#/state/account/accountActivity.ts";
import { SERVER_ORIGIN } from "#/state/account/auth.ts";

/**
 * The account's Activity page: the lines of the audit log about this user,
 * so what an admin can see about someone, that person can see too, including
 * an admin downloading their notes.
 */
export function ActivitySettings() {
  return (
    <div class="space-y-4">
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {t("activity.hint", { server: SERVER_ORIGIN ?? "" })}
      </p>
      <AuditLog load={loadAccountActivity} />
    </div>
  );
}
