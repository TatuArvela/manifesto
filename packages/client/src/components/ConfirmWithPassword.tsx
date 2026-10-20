import { t } from "#/i18n/index.ts";
import { currentUser } from "#/state/account/auth.ts";
import { beginOidcSignIn, oidcReauthUrl } from "#/state/account/oidcSignIn.ts";
import {
  CONFIRMATION_MESSAGES,
  type ConfirmationRefusal,
} from "#/state/account/passwordConfirmation.ts";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-sm max-sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

/**
 * The password again, for the actions that would let the holder of a stolen
 * session keep the account (an email address, a token, a webhook). Only an
 * account that has a password sees it. An account that signs in through an
 * identity provider must have a recent sign-in in its place
 * (`ConfirmationError`). It has the size of the Settings fields around it. A
 * full page with larger fields gives its own `inputClass`.
 */
export function ConfirmPasswordField({
  value,
  onInput,
  inputClass: fieldClass = inputClass,
}: {
  value: string;
  onInput: (value: string) => void;
  inputClass?: string | undefined;
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
        class={fieldClass}
      />
    </label>
  );
}

/**
 * Why the server needed more before it did the action, with the way to give it.
 */
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
          <a
            href={signIn}
            onClick={beginOidcSignIn}
            onAuxClick={beginOidcSignIn}
            class="underline font-medium"
          >
            {t("confirm.signInAgainLink")}
          </a>
        </>
      )}
    </p>
  );
}
