import { Bell, BellRing, X } from "lucide-preact";
import { t } from "#/i18n/index.ts";
import { markReminderDone, reminderBanner } from "#/state/reminderScheduler.ts";
import { editingNoteId } from "#/state/ui.ts";

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
      <div
        class={`flex items-start gap-3 px-4 py-3 rounded-lg shadow-lg text-white animate-fade-in ${
          banner.urgent ? "bg-red-700" : "bg-amber-500"
        }`}
        role={banner.urgent ? "alert" : undefined}
      >
        {banner.urgent ? (
          <BellRing class="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        ) : (
          <Bell class="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
        )}
        <div class="flex-1 min-w-0">
          <div class="font-medium truncate">{banner.title}</div>
          {banner.body && (
            <div class="text-sm text-white/90 line-clamp-2">{banner.body}</div>
          )}
          <div class="mt-2 flex gap-4">
            <button
              type="button"
              class="text-sm font-medium underline underline-offset-2 hover:no-underline cursor-pointer"
              onClick={open}
            >
              {t("reminder.openNote")}
            </button>
            {banner.urgent && (
              <button
                type="button"
                class="text-sm font-medium underline underline-offset-2 hover:no-underline cursor-pointer"
                onClick={() => markReminderDone(banner.noteId)}
              >
                {t("reminder.done")}
              </button>
            )}
          </div>
        </div>
        <button
          type="button"
          class="-m-0.5 p-1 rounded hover:bg-white/20 shrink-0 cursor-pointer"
          onClick={dismiss}
          aria-label={t("reminder.dismiss")}
        >
          <X class="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
