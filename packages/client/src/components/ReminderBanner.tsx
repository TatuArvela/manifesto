import { Bell, X } from "lucide-preact";
import { t } from "../i18n/index.js";
import { reminderBanner } from "../state/reminderScheduler.js";
import { editingNoteId } from "../state/ui.js";

export function ReminderBanner() {
  const banner = reminderBanner.value;
  if (!banner) return null;

  const open = () => {
    editingNoteId.value = banner.noteId;
    reminderBanner.value = null;
  };
  const dismiss = () => {
    reminderBanner.value = null;
  };

  return (
    <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-md w-[calc(100%-2rem)]">
      <div class="flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg bg-amber-500 text-white animate-fade-in">
        <Bell class="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate">{banner.title}</div>
          {banner.body && (
            <div class="text-sm text-white/90 line-clamp-2">{banner.body}</div>
          )}
          <button
            type="button"
            class="mt-2 text-sm font-medium underline underline-offset-2 hover:no-underline cursor-pointer"
            onClick={open}
          >
            {t("reminder.openNote")}
          </button>
        </div>
        <button
          type="button"
          class="p-0.5 rounded hover:bg-white/20 shrink-0 cursor-pointer"
          onClick={dismiss}
          aria-label={t("reminder.dismiss")}
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
