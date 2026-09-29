import { t } from "../../i18n/index.js";
import { loadAccountActivity } from "../../state/accountActivity.js";
import { SERVER_ORIGIN } from "../../state/auth.js";
import { AuditLog } from "../admin/AuditLog.js";

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
