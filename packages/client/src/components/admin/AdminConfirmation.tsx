import {
  ConfirmationError,
  ConfirmPasswordField,
} from "#/components/ConfirmWithPassword.tsx";
import { currentUser } from "#/state/account/auth.ts";
import type { ConfirmationRefusal } from "#/state/account/passwordConfirmation.ts";
import type { AdminChange } from "#/state/admin.ts";

/** What the forms of the admin view share. */

export const fieldClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

/** The refusal in what a change gave, or null when it was not refused. */
export function refusalIn(change: AdminChange): ConfirmationRefusal | null {
  return change === "done" || change === "failed" ? null : change;
}

/**
 * The password of the admin for a change to an account, and why the server
 * refused the last try. The server asks for it on each change, because a stolen
 * admin session could otherwise give itself an account that stays an admin.
 */
export function AdminConfirmation({
  password,
  onPassword,
  refusal,
}: {
  password: string;
  onPassword: (value: string) => void;
  refusal: ConfirmationRefusal | null;
}) {
  return (
    <>
      {currentUser.value?.hasPassword === true && (
        <div class="flex-1 min-w-48">
          <ConfirmPasswordField
            value={password}
            onInput={onPassword}
            inputClass={fieldClass}
          />
        </div>
      )}
      {refusal && (
        <div class="w-full">
          <ConfirmationError refusal={refusal} />
        </div>
      )}
    </>
  );
}
