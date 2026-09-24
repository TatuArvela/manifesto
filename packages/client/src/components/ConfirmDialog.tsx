import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import { answerConfirmation, confirmRequest } from "../state/confirm.js";
import { Backdrop } from "./Backdrop.js";

/**
 * The one place a destructive action stops to ask. Driven by the
 * `confirmRequest` signal rather than mounted per call site, because the
 * question is asked from card menus, the trash view and the header's selection
 * bar, and only ever one at a time.
 *
 * Escape and the backdrop both answer "no", which is the safe answer: the
 * gesture that dismisses a dialog must never be the one that deletes.
 */
export function ConfirmDialogHost() {
  const request = confirmRequest.value;
  const [closing, setClosing] = useState(false);
  // Held across the fade-out so the panel still has something to draw after
  // the signal has been cleared.
  const shownRef = useRef(request);
  if (request) shownRef.current = request;
  const shown = shownRef.current;

  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(!!request);

  // Cancel, not confirm: the keyboard should land on the way out, so that a
  // stray Enter on a dialog nobody read closes it rather than deleting.
  useEffect(() => {
    if (request) cancelRef.current?.focus();
  }, [request]);

  useEffect(() => {
    if (request) {
      setClosing(false);
      return;
    }
    if (!shownRef.current) return;
    setClosing(true);
    const timer = setTimeout(() => setClosing(false), 150);
    return () => clearTimeout(timer);
  }, [request]);

  useEscapeStack(!!request, () => answerConfirmation(false));

  if (!shown || (!request && !closing)) return null;

  return (
    <>
      <Backdrop
        onDismiss={() => answerConfirmation(false)}
        closing={closing}
        class="z-[60]"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={shown.body ? "confirm-dialog-body" : undefined}
        class={`fixed inset-0 z-[60] flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <div class="pointer-events-auto w-full max-w-sm rounded-lg bg-white dark:bg-neutral-800 shadow-xl border border-neutral-200 dark:border-neutral-700 overflow-hidden">
          <div class="px-5 pt-5 pb-4">
            <h2
              id="confirm-dialog-title"
              class="text-base font-semibold leading-snug"
            >
              {shown.title}
            </h2>
            {shown.body && (
              <p
                id="confirm-dialog-body"
                class="mt-1.5 text-sm text-neutral-600 dark:text-neutral-300"
              >
                {shown.body}
              </p>
            )}
          </div>
          <div class="px-5 pb-4 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              class="px-4 py-2 text-sm rounded-lg font-medium hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              onClick={() => answerConfirmation(false)}
            >
              {t("confirm.cancel")}
            </button>
            <button
              type="button"
              class="px-4 py-2 text-sm rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 cursor-pointer"
              onClick={() => answerConfirmation(true)}
            >
              {shown.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
