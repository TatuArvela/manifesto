import { t } from "../i18n/index.js";
import { currentUser, oidcReauthUrl } from "../state/auth.js";
import {
  CONFIRMATION_MESSAGES,
  type ConfirmationRefusal,
} from "../state/passwordConfirmation.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

/**
 * The password again, for the actions that would let whoever holds a stolen
 * session keep the account (an email address, a token, a webhook). Shown only
 * to an account that has one: one signed in through an identity provider is
 * asked to have signed in recently instead (`ConfirmationError`).
 */
export function ConfirmPasswordField({
  value,
  onInput,
}: {
  value: string;
  onInput: (value: string) => void;
}) {
  if (currentUser.value?.hasPassword !== true) return null;
  return (
    <label class="block">
      <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
        {t("confirm.password")}
      </span>
      <input
        type="password"
        autoComplete="current-password"
        maxLength={256}
        value={value}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
        class={inputClass}
      />
    </label>
  );
}

/** Why the server wanted more before doing it, with the way to give it. */
export function ConfirmationError({
  refusal,
}: {
  refusal: ConfirmationRefusal;
}) {
  const signIn = refusal === "sign-in-again" ? oidcReauthUrl : null;
  return (
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">
      {t(CONFIRMATION_MESSAGES[refusal])}
      {signIn && (
        <>
          {" "}
          <a href={signIn} class="underline font-medium">
            {t("confirm.signInAgainLink")}
          </a>
        </>
      )}
    </p>
  );
}
