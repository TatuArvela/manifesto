import { CloudOff } from "lucide-preact";
import { t } from "#/i18n/index.ts";
import { connectionStatus } from "#/realtime/appSocket.ts";
import { connectionOutage } from "#/realtime/connectionOutage.ts";
import { isServerMode } from "#/state/account/auth.ts";

/**
 * A small banner at the bottom of the viewport. It shows after the realtime
 * application socket was away long enough to count as an outage (the server is
 * not available, the browser is offline, and so on). Local edits continue to
 * work. They only do not go to other devices until the banner clears.
 *
 * It follows `connectionOutage`, not `connectionStatus`. Thus, a resumed app
 * that reconnects does not announce itself. See that module for the reason.
 */
export function ConnectionStatus() {
  if (!isServerMode) return null;
  if (!connectionOutage.value) return null;
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
