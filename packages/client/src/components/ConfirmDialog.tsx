import { useEffect, useRef, useState } from "preact/hooks";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { t } from "#/i18n/index.ts";
import { answerConfirmation, confirmRequest } from "#/state/confirm.ts";
import { Backdrop } from "./Backdrop.tsx";
import { buttonClass } from "./buttonClasses.ts";

/**
 * The only place where a destructive action stops to ask. The `confirmRequest`
 * signal controls it. It is not mounted for each caller, because card menus,
 * the trash view and the selection bar of the header ask the question, and only
 * one at a time.
 *
 * Escape and the backdrop both answer "no", which is the safe answer. The
 * gesture that dismisses a dialog must never be the gesture that deletes.
 */
export function ConfirmDialogHost() {
  const request = confirmRequest.value;
  const [closing, setClosing] = useState(false);
  // Kept across the fade-out. Thus, the panel still has something to draw after
  // the signal was cleared.
  const shownRef = useRef(request);
  if (request) shownRef.current = request;
  const shown = shownRef.current;

  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useFocusTrap<HTMLDivElement>(!!request);

  // Cancel, not confirm. The keyboard must go to the way out. Thus, an
  // accidental Enter on a dialog that nobody read closes it, and does not
  // delete.
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
        class="layer-confirm"
      />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={shown.body ? "confirm-dialog-body" : undefined}
        class={`fixed inset-0 layer-confirm flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
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
              class={buttonClass("quiet")}
              onClick={() => answerConfirmation(false)}
            >
              {t("confirm.cancel")}
            </button>
            <button
              type="button"
              class={buttonClass("danger")}
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
