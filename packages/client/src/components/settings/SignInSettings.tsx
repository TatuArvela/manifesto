import { useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import { t } from "#/i18n/index.ts";
import { changePassword } from "#/state/account/auth.ts";
import { showSuccess } from "#/state/ui.ts";
import { Field, inputClass, Section } from "./AccountSettings.tsx";
import { showsTwoFactor } from "./SettingsNav.tsx";
import { TwoFactorSettings } from "./TwoFactorSettings.tsx";

/**
 * The ways into a local account, together: its password, and the second factor
 * that the server offers or that the account already has (`showsTwoFactor`).
 * Single sign-on has neither here. Thus, the page is only for an account with
 * its own password.
 */
export function SignInSettings() {
  const [changing, setChanging] = useState(false);
  return (
    <div class="space-y-8">
      <Section title={t("account.password")}>
        {changing ? (
          <PasswordForm onDone={() => setChanging(false)} />
        ) : (
          <div class="flex flex-col sm:flex-row sm:items-center gap-3">
            <p class="flex-1 text-sm text-neutral-500 dark:text-neutral-400">
              {t("account.password.hint")}
            </p>
            <button
              type="button"
              class={`${buttonClass("secondary", "sm")} self-end sm:self-auto shrink-0`}
              onClick={() => setChanging(true)}
            >
              {t("account.changePassword")}
            </button>
          </div>
        )}
      </Section>

      {showsTwoFactor() && (
        <Section title={t("twoFactor.title")}>
          <TwoFactorSettings />
        </Section>
      )}
    </div>
  );
}

/**
 * Change your own password. All other sessions of the account end, and this
 * session continues. The success message tells this. Thus, the sign-out on a
 * different device is not a surprise.
 */
function PasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (current.length === 0) return setError(t("login.passwordRequired"));
    if (next.length < 8) return setError(t("login.passwordTooShort"));
    if (next !== confirm) return setError(t("login.passwordMismatch"));
    if (next === current) return setError(t("account.samePassword"));
    setError(null);
    setBusy(true);
    const result = await changePassword(current, next);
    setBusy(false);
    if (result === "ok") {
      showSuccess(t("account.passwordChanged"));
      onDone();
      return;
    }
    setError(
      t(
        result === "wrong-password"
          ? "account.wrongPassword"
          : result === "same-password"
            ? "account.samePassword"
            : "account.changeFailed",
      ),
    );
  };

  const field = (
    label: string,
    value: string,
    set: (value: string) => void,
    autoComplete: string,
    first = false,
  ) => (
    <Field label={label}>
      <input
        type="password"
        autoComplete={autoComplete}
        // biome-ignore lint/a11y/noAutofocus: opened by the button for this
        autoFocus={first}
        value={value}
        onInput={(e) => set((e.currentTarget as HTMLInputElement).value)}
        class={inputClass}
      />
    </Field>
  );

  return (
    <form onSubmit={submit} class="space-y-3">
      {field(
        t("account.currentPassword"),
        current,
        setCurrent,
        "current-password",
        true,
      )}
      {field(t("login.newPassword"), next, setNext, "new-password")}
      {field(t("login.confirmPassword"), confirm, setConfirm, "new-password")}
      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div class="flex justify-end gap-2">
        <button type="button" class={buttonClass("secondary")} onClick={onDone}>
          {t("confirm.cancel")}
        </button>
        <button type="submit" disabled={busy} class={buttonClass("primary")}>
          {busy ? t("login.submitting") : t("account.changePassword")}
        </button>
      </div>
    </form>
  );
}
