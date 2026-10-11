import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { type MessageKey, t } from "../i18n/index.js";
import {
  abandonRecovery,
  beginRecovery,
  beginRecoverySignIn,
  completeRecovery,
  type KeySheet,
  type RecoveryResult,
} from "../state/accountKeys.js";
import { userKeyKindOf } from "../utils/userKey.js";
import { KeepSheetStep } from "./KeySheet.js";
import { inputClass, quietClass, submitClass } from "./loginFormClasses.js";

// Using the recovery key, in both places it can be: on the sign-in screen,
// with the username, by someone who has lost everything else, and on the
// unlock screen by someone who is signed in and has lost the secret key.
// Either way it is two steps: the key, then a sheet with the new keys that
// take the place of the ones used.

const BEGIN_FAILURES: Record<
  Exclude<RecoveryResult["kind"], "ok">,
  MessageKey
> = {
  invalid: "keys.recover.invalid",
  wrong: "keys.recover.wrong",
  throttled: "login.tooManyAttempts",
  failed: "keys.failed",
};

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">
      {message}
    </p>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the input arrives as children
    <label class="block">
      <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

/** A field for one of the two keys, as typed or pasted. */
export function UserKeyInput({
  value,
  onInput,
  placeholder,
}: {
  value: string;
  onInput: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      type="text"
      autoComplete="off"
      autoCapitalize="characters"
      autoCorrect="off"
      spellcheck={false}
      // biome-ignore lint/a11y/noAutofocus: the one thing to do on this step
      autoFocus
      maxLength={80}
      placeholder={placeholder}
      value={value}
      onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)}
      class={`${inputClass} font-mono tracking-wide`}
    />
  );
}

/**
 * `withUsername` is the sign-in screen's form, where nobody is signed in:
 * the recovery then chooses a new password and signs in.
 */
export function RecoveryForm({
  withUsername,
  onBack,
}: {
  withUsername: boolean;
  onBack: () => void;
}) {
  const [username, setUsername] = useState("");
  const [key, setKey] = useState("");
  const [sheet, setSheet] = useState<KeySheet | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (withUsername && username.trim().length === 0) {
      setError(t("login.usernameRequired"));
      return;
    }
    if (userKeyKindOf(key) === "secret") {
      setError(t("keys.recover.isSecretKey"));
      return;
    }
    setError(null);
    setBusy(true);
    const result = withUsername
      ? await beginRecoverySignIn(username.trim(), key)
      : await beginRecovery(key);
    setBusy(false);
    if (result.kind === "ok") setSheet(result.sheet);
    else setError(t(BEGIN_FAILURES[result.kind]));
  };

  const complete = async () => {
    if (withUsername) {
      if (newPassword.length < 8) {
        setError(t("login.passwordTooShort"));
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(t("login.passwordMismatch"));
        return;
      }
    }
    setError(null);
    setBusy(true);
    const result = await completeRecovery(
      withUsername ? newPassword : undefined,
    );
    setBusy(false);
    if (result === "used") setError(t("keys.recover.used"));
    else if (result === "failed") setError(t("keys.failed"));
  };

  const back = () => {
    abandonRecovery();
    onBack();
  };

  if (sheet) {
    return (
      <div class="space-y-4">
        <div>
          <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
            {t("keys.recover.sheetTitle")}
          </h2>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            {t("keys.recover.sheetHint")}
          </p>
        </div>
        <KeepSheetStep
          sheet={sheet}
          submitLabel={t(
            withUsername ? "keys.recover.finishSignIn" : "keys.recover.finish",
          )}
          error={<ErrorLine message={error} />}
          busy={busy}
          onSubmit={() => void complete()}
        >
          {withUsername && (
            <>
              {/* Lets a password manager file the new password under this account. */}
              <input
                type="text"
                autoComplete="username"
                value={username}
                readOnly
                hidden
              />
              <Field label={t("login.newPassword")}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onInput={(e) =>
                    setNewPassword((e.currentTarget as HTMLInputElement).value)
                  }
                  class={inputClass}
                />
              </Field>
              <Field label={t("login.confirmPassword")}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onInput={(e) =>
                    setConfirmPassword(
                      (e.currentTarget as HTMLInputElement).value,
                    )
                  }
                  class={inputClass}
                />
              </Field>
            </>
          )}
        </KeepSheetStep>
        <button type="button" class={quietClass} onClick={back}>
          {t("login.back")}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={begin} class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t("keys.recover.title")}
        </h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {t(withUsername ? "keys.recover.signInHint" : "keys.recover.hint")}
        </p>
      </div>
      {withUsername && (
        <Field label={t("login.username")}>
          <input
            type="text"
            autoComplete="username"
            value={username}
            onInput={(e) =>
              setUsername((e.currentTarget as HTMLInputElement).value)
            }
            class={inputClass}
          />
        </Field>
      )}
      <Field label={t("keys.recoveryKey")}>
        <UserKeyInput
          value={key}
          onInput={setKey}
          placeholder="RK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        />
      </Field>
      <ErrorLine message={error} />
      <button type="submit" disabled={busy} class={submitClass}>
        {busy ? t("login.submitting") : t("keys.continue")}
      </button>
      <button type="button" class={quietClass} onClick={back}>
        {t("login.back")}
      </button>
    </form>
  );
}
