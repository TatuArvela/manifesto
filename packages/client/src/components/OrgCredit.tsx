import { ORG_LOGO_URL, ORG_NAME } from "../config.js";

/**
 * The organisation that owns this copy of the app, when the deployment says:
 * its logo, drawn as it is, and its name. The name alone, with no "provided
 * by" or the like: the organisation owns the instance, which is not the same
 * as providing a service, and one prefix could not say which it is for every
 * deployment. Nothing when neither is set. A logo with no name stands alone,
 * labelled by nothing, so it is decorative.
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
          {ORG_NAME}
        </span>
      )}
    </div>
  );
}
