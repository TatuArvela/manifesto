import { Fragment } from "preact";
import { useState } from "preact/hooks";
import { BOARD_SHORTCUTS } from "../hooks/useBoardShortcuts.js";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import { showShortcuts } from "../state/ui.js";
import { Backdrop } from "./Backdrop.js";

/** How long the fade-out runs; matches the `duration-150` classes below. */
const CLOSE_MS = 150;

/** The `?` sheet: every board shortcut and what it does. */
export function ShortcutsDialog() {
  const [closing, setClosing] = useState(false);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      showShortcuts.value = false;
    }, CLOSE_MS);
  };

  useEscapeStack(true, dismiss);
  const dialogRef = useFocusTrap<HTMLDivElement>(!closing);

  return (
    <>
      <Backdrop onDismiss={dismiss} closing={closing} class="z-40" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-dialog-title"
        class={`fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <div class="pointer-events-auto w-full max-w-sm max-h-full overflow-y-auto overscroll-contain rounded-xl bg-white dark:bg-neutral-800 shadow-xl p-5 text-neutral-900 dark:text-neutral-100">
          <h2 id="shortcuts-dialog-title" class="text-lg font-semibold mb-3">
            {t("shortcuts.title")}
          </h2>
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {BOARD_SHORTCUTS.map(([key, label]) => (
              <Fragment key={key}>
                <dt>
                  <kbd class="inline-block min-w-7 text-center px-1.5 py-0.5 rounded-md border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-700 font-mono text-xs">
                    {key}
                  </kbd>
                </dt>
                <dd class="text-neutral-700 dark:text-neutral-300">
                  {t(label)}
                </dd>
              </Fragment>
            ))}
          </dl>
          <p class="mt-4 text-xs text-neutral-500 dark:text-neutral-400">
            {t("shortcuts.note")}
          </p>
          <div class="mt-4 flex justify-end">
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
              onClick={dismiss}
            >
              {t("shortcuts.close")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
