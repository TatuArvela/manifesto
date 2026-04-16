import { X } from "lucide-preact";
import { dismissError, errors } from "../state/ui.js";

export function Toasts() {
  if (errors.value.length === 0) return null;

  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {errors.value.map((error) => (
        <div
          key={error.id}
          class="flex items-start gap-2 px-4 py-3 bg-red-600 text-white rounded-lg shadow-lg animate-fade-in text-sm"
        >
          <span class="flex-1">{error.message}</span>
          <button
            type="button"
            class="p-0.5 rounded hover:bg-white/20 shrink-0 cursor-pointer"
            onClick={() => dismissError(error.id)}
            aria-label="Dismiss"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
