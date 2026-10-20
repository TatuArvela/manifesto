import { ORG_LOGO, ORG_NAME } from "#/config.ts";
import { BrandLogo } from "./BrandLogo.tsx";

/**
 * The organization that owns this copy of the app, when the deployment tells
 * it: its logo, drawn as it is, and its name. Only the name, with no "provided
 * by" or similar words. The organization owns the instance, which is not the
 * same as to provide a service, and one prefix could not be correct for all
 * deployments. Nothing when neither is set. A logo with no name is alone, and
 * nothing labels it. Thus, it is decorative.
 */
export function OrgCredit({ class: className = "" }: { class?: string }) {
  if (!ORG_NAME && !ORG_LOGO) return null;
  return (
    <div class={`flex items-center justify-center gap-2 ${className}`}>
      {ORG_LOGO && (
        <BrandLogo logo={ORG_LOGO} class="h-6 w-auto max-w-24 object-contain" />
      )}
      {ORG_NAME && (
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          {ORG_NAME}
        </span>
      )}
    </div>
  );
}
