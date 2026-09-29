import type { PasskeyRequestOptions } from "@manifesto/shared";
import { t } from "../i18n/index.js";
import { passkeysSupported } from "../utils/webauthn.js";
import { inputClass, quietClass, submitClass } from "./loginFormClasses.js";

// The steps a password sign-in can pass through after the password itself.
// Presentational: `LocalLoginForm` holds the fields and does the signing in.

/** What the two-factor step can take: the app's codes (recovery codes are
 * always typed), and a challenge for the account's passkeys here. */
export interface SecondFactor {
  authenticator: boolean;
  passkey: PasskeyRequestOptions | null;
}

/** Asks for the second factor: a code, or the account's passkey. */
export function TwoFactorStep({
  secondFactor,
  otp,
  setOtp,
  error,
  submitting,
  onSubmit,
  onPasskey,
  onBack,
}: {
  secondFactor: SecondFactor;
  otp: string;
  setOtp: (value: string) => void;
  error: string | null;
  submitting: boolean;
  onSubmit: (event: Event) => void;
  onPasskey: () => void;
  onBack: () => void;
}) {
  return (
    <form onSubmit={onSubmit} class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t("login.twoFactor.title")}
        </h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {t(
            secondFactor.authenticator
              ? "login.twoFactor.hint"
              : "login.twoFactor.recoveryHint",
          )}
        </p>
      </div>
      {secondFactor.passkey && passkeysSupported() && (
        <>
          <button
            type="button"
            disabled={submitting}
            onClick={onPasskey}
            class={submitClass}
          >
            {t("login.twoFactor.usePasskey")}
          </button>
          <div class="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            <span class="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
            {t("login.or")}
            <span class="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
          </div>
        </>
      )}
      <label class="block">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
          {t(
            secondFactor.authenticator
              ? "login.twoFactor.code"
              : "login.twoFactor.recoveryCode",
          )}
        </span>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          // biome-ignore lint/a11y/noAutofocus: the one thing to do on this step
          autoFocus
          maxLength={32}
          value={otp}
          onInput={(e) => setOtp((e.currentTarget as HTMLInputElement).value)}
          class={`${inputClass} tracking-widest`}
        />
      </label>
      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting} class={submitClass}>
        {submitting ? t("login.submitting") : t("login.twoFactor.submit")}
      </button>
      <button type="button" class={quietClass} onClick={onBack}>
        {t("login.back")}
      </button>
    </form>
  );
}

/**
 * The step after signing in with a temporary password an admin issued: the
 * server answers with no session until a new one is chosen.
 */
export function ChangePasswordStep({
  username,
  newPassword,
  setNewPassword,
  confirmPassword,
  setConfirmPassword,
  error,
  submitting,
  onSubmit,
  onBack,
}: {
  username: string;
  newPassword: string;
  setNewPassword: (value: string) => void;
  confirmPassword: string;
  setConfirmPassword: (value: string) => void;
  error: string | null;
  submitting: boolean;
  onSubmit: (event: Event) => void;
  onBack: () => void;
}) {
  return (
    <form onSubmit={onSubmit} class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t("login.changePassword.title")}
        </h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {t("login.changePassword.hint")}
        </p>
      </div>
      {/* Lets a password manager file the new password under this account. */}
      <input
        type="text"
        autoComplete="username"
        value={username}
        readOnly
        hidden
      />
      <label class="block">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
          {t("login.newPassword")}
        </span>
        <input
          type="password"
          autoComplete="new-password"
          // biome-ignore lint/a11y/noAutofocus: the one thing to do on this step
          autoFocus
          value={newPassword}
          onInput={(e) =>
            setNewPassword((e.currentTarget as HTMLInputElement).value)
          }
          class={inputClass}
        />
      </label>
      <label class="block">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
          {t("login.confirmPassword")}
        </span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onInput={(e) =>
            setConfirmPassword((e.currentTarget as HTMLInputElement).value)
          }
          class={inputClass}
        />
      </label>

      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={submitting} class={submitClass}>
        {submitting ? t("login.submitting") : t("login.submitChangePassword")}
      </button>
      <button type="button" class={quietClass} onClick={onBack}>
        {t("login.back")}
      </button>
    </form>
  );
}
