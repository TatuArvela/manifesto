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
 * Checks the saved account against the server after the board shows, and if it
 * can be on `/admin`. Answers if the user is an admin.
 *
 * Admin rights can change while the user is signed out. Thus, the `/admin`
 * route waits for the answer of the server before it decides that a person does
 * not belong on it.
 */
export function useAccountCheck(): { isAdmin: boolean } {
  const [userChecked, setUserChecked] = useState(!isServerMode);

  useEffect(() => {
    if (!isServerMode) return;
    void refreshCurrentUser().finally(() => setUserChecked(true));
    // After the capabilities, which tell if sharing is on.
    void fetchCapabilities().then(() => {
      void loadInvitations();
      // A browser that already permits notifications starts, or renews, its
      // push subscription. A browser that does not permit them gets the
      // question when the first reminder is saved, not here.
      void ensurePushSubscription();
    });
  }, []);

  const isAdmin = isServerMode && currentUser.value?.isAdmin === true;
  const isAdminView = activeView.value === "admin";

  useEffect(() => {
    if (isAdminView && userChecked && !isAdmin) activeView.value = "active";
  }, [isAdminView, userChecked, isAdmin]);

  // An admin learns about a newer release in the account menu.
  useEffect(() => {
    if (userChecked && isAdmin) void checkForUpdate();
  }, [userChecked, isAdmin]);

  return { isAdmin };
}
