import { t } from "../i18n/index.js";
import type { ServerSetupProblem } from "../utils/serverCsp.js";

interface Props {
  problem: ServerSetupProblem;
}

/**
 * Shown instead of the app when this page cannot reach the server it names.
 *
 * It takes the whole screen rather than warning beside a login form, because
 * in this state every request is blocked before it leaves the browser: the
 * form would accept a password and then fail with nothing to go on. The
 * audience is whoever deployed the copy, so the text names the file and the
 * exact lines to add, and the app offers no way past it. There is nothing on
 * the other side.
 */
export function ServerSetupError({ problem }: Props) {
  return (
    <div class="min-h-screen flex items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-900">
      <div class="max-w-md w-full bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 p-6">
        <h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          {t("setup.title")}
        </h1>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {problem.kind === "invalid-url"
            ? t("setup.invalidBody", { server: problem.serverUrl })
            : t("setup.cspBody", { server: problem.serverUrl })}
        </p>

        {problem.kind === "csp-blocked" && (
          <>
            <p class="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
              {t("setup.cspAdd")}
            </p>
            <pre class="mt-2 p-2 rounded bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-700 dark:text-neutral-300 overflow-x-auto whitespace-pre-wrap">
              {problem.missing.join("\n")}
            </pre>
            <p class="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
              {t("setup.cspWhere")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
