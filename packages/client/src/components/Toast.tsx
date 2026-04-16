import { X } from "lucide-preact";
import { dismissToast, toasts } from "../state/ui.js";

export function Toasts() {
  if (toasts.value.length === 0) return null;

  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.value.map((toast) => (
        <div
          key={toast.id}
          class={`flex items-start gap-2 px-4 py-3 text-white rounded-lg shadow-lg animate-fade-in text-sm ${
            toast.type === "error" ? "bg-red-600" : "bg-green-600"
          }`}
        >
          <span class="flex-1">{toast.message}</span>
          <button
            type="button"
            class="p-0.5 rounded hover:bg-white/20 shrink-0 cursor-pointer"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
