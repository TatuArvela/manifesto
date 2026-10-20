import { X } from "lucide-preact";
import { t } from "#/i18n/index.ts";
import { dismissToast, holdToasts, toasts } from "#/state/ui.ts";

/**
 * The toast stack. The region is on the page also while it is empty, because a
 * screen reader announces only what arrives in a live region that already
 * exists. On a phone, it uses the full width and is above the new-note button
 * (`NoteInput`), which it would otherwise cover. When the pointer is on it or
 * it has focus, the success messages that would go away by themselves stay.
 */
export function Toasts() {
  return (
    <div
      class="fixed layer-toast flex flex-col gap-2 pointer-events-none right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] max-md:left-4 max-md:bottom-[calc(6rem+env(safe-area-inset-bottom))] md:max-w-sm"
      role="status"
      aria-live="polite"
      onPointerEnter={() => holdToasts(true)}
      onPointerLeave={() => holdToasts(false)}
      onFocusIn={() => holdToasts(true)}
      onFocusOut={(e) => {
        const to = e.relatedTarget;
        if (!(to instanceof Node && e.currentTarget.contains(to))) {
          holdToasts(false);
        }
      }}
    >
      {toasts.value.map((toast) => (
        <div
          key={toast.id}
          role={toast.type === "error" ? "alert" : undefined}
          class={`pointer-events-auto flex items-start gap-2 px-4 py-3 text-white rounded-lg shadow-lg animate-fade-in text-sm ${
            toast.type === "error" ? "bg-red-600" : "bg-green-700"
          }`}
        >
          <span class="flex-1">{toast.message}</span>
          <button
            type="button"
            class="-m-0.5 p-1 rounded hover:bg-white/20 shrink-0 cursor-pointer"
            onClick={() => dismissToast(toast.id)}
            aria-label={t("toast.dismiss")}
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
