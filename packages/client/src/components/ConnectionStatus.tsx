import { CloudOff } from "lucide-preact";
import { t } from "../i18n/index.js";
import { connectionStatus } from "../realtime/appSocket.js";
import { isServerMode } from "../state/auth.js";

/**
 * Tiny banner shown at the bottom of the viewport when the realtime
 * application socket is disconnected (server unreachable, browser offline,
 * etc.). Local edits keep working — they just don't propagate until the
 * banner clears.
 */
export function ConnectionStatus() {
  if (!isServerMode) return null;
  if (connectionStatus.value === "open") return null;
  if (connectionStatus.value === "idle") return null;
  return (
    <div
      role="status"
      aria-live="polite"
      class="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-800/90 dark:bg-neutral-100/90 text-white dark:text-neutral-900 text-xs font-medium shadow-lg pointer-events-none"
    >
      <CloudOff class="w-3.5 h-3.5" />
      <span>
        {connectionStatus.value === "connecting"
          ? t("connection.reconnecting")
          : t("connection.disconnected")}
      </span>
    </div>
  );
}
