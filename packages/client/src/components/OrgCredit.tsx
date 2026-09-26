import { ORG_LOGO_URL, ORG_NAME } from "../config.js";
import { t } from "../i18n/index.js";

/**
 * Who runs this copy of the app, when the deployment says: the organisation's
 * logo, drawn as it is, and "Provided by <name>". Nothing when neither is set.
 * A logo with no name stands alone, labelled by nothing, so it is decorative.
 */
export function OrgCredit({ class: className = "" }: { class?: string }) {
  if (!ORG_NAME && !ORG_LOGO_URL) return null;
  return (
    <div class={`flex items-center justify-center gap-2 ${className}`}>
      {ORG_LOGO_URL && (
        <img src={ORG_LOGO_URL} alt="" class="h-6 max-w-24 object-contain" />
      )}
      {ORG_NAME && (
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          {t("branding.providedBy", { name: ORG_NAME })}
        </span>
      )}
    </div>
  );
}
