import { useEffect, useState } from "preact/hooks";
import {
  currentUser,
  fetchCapabilities,
  isServerMode,
  refreshCurrentUser,
} from "#/state/account/auth.ts";
import { checkForUpdate } from "#/state/admin.ts";
import { ensurePushSubscription } from "#/state/pushSubscription.ts";
import { loadInvitations } from "#/state/sharing.ts";
import { activeView } from "#/state/ui.ts";

/**
 * Checks the saved account against the server once the board is up, and
 * whether it may be on `/admin`. Answers whether the user is an admin.
 *
 * Admin rights can change while signed out, so the `/admin` route waits for
 * the server's answer before deciding someone does not belong on it.
 */
export function useAccountCheck(): { isAdmin: boolean } {
  const [userChecked, setUserChecked] = useState(!isServerMode);

  useEffect(() => {
    if (!isServerMode) return;
    void refreshCurrentUser().finally(() => setUserChecked(true));
    // After the capabilities, which say whether sharing is on at all.
    void fetchCapabilities().then(() => {
      void loadInvitations();
      // A browser that already allows notifications takes up, or renews,
      // its push subscription; one that does not is asked when a reminder
      // is first saved, not here.
      void ensurePushSubscription();
    });
  }, []);

  const isAdmin = isServerMode && currentUser.value?.isAdmin === true;
  const isAdminView = activeView.value === "admin";

  useEffect(() => {
    if (isAdminView && userChecked && !isAdmin) activeView.value = "active";
  }, [isAdminView, userChecked, isAdmin]);

  // An admin hears about a newer release in the account menu.
  useEffect(() => {
    if (userChecked && isAdmin) void checkForUpdate();
  }, [userChecked, isAdmin]);

  return { isAdmin };
}
