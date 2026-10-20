import { AuditLog } from "#/components/admin/AuditLog.tsx";
import { t } from "#/i18n/index.ts";
import { loadAccountActivity } from "#/state/account/accountActivity.ts";
import { SERVER_ORIGIN } from "#/state/account/auth.ts";

/**
 * The Activity page of the account: the lines of the audit log about this user.
 * Thus, what an admin can see about a person, that person can also see, also a
 * download of their notes by an admin.
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
