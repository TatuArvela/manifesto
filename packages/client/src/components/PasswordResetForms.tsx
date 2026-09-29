import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { confirmPasswordReset, requestPasswordReset } from "../state/auth.js";
import { locale } from "../state/prefs.js";
import { showSuccess } from "../state/ui.js";
import { inputClass, quietClass, submitClass } from "./loginFormClasses.js";

/** Asks for a reset link by mail; says the same whatever the address. */
export function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const submit = async (event: Event) => {
    event.preventDefault();
    if (state === "sending" || email.trim().length === 0) return;
    setState("sending");
    const ok = await requestPasswordReset(email.trim(), locale.value);
    setState(ok ? "sent" : "failed");
  };
  return (
    <form onSubmit={submit} class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t("login.forgot.title")}
        </h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {state === "sent" ? t("login.forgot.sent") : t("login.forgot.hint")}
        </p>
      </div>
      {state !== "sent" && (
        <>
          <label class="block">
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
              {t("login.email")}
            </span>
            <input
              type="email"
              autoComplete="email"
              // biome-ignore lint/a11y/noAutofocus: the one thing to do on this step
              autoFocus
              required
              maxLength={254}
              value={email}
              onInput={(e) =>
                setEmail((e.currentTarget as HTMLInputElement).value)
              }
              class={inputClass}
            />
          </label>
          {state === "failed" && (
            <p class="text-sm text-red-600 dark:text-red-400" role="alert">
              {t("login.serverUnavailable")}
            </p>
          )}
          <button
            type="submit"
            disabled={state === "sending"}
            class={submitClass}
          >
            {t("login.forgot.submit")}
          </button>
        </>
      )}
      <button type="button" class={quietClass} onClick={onBack}>
        {t("login.back")}
      </button>
    </form>
  );
}

/** Sets a new password from a mailed link. */
export function ResetPasswordForm({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) {
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (next.length < 8) return setError(t("login.passwordTooShort"));
    if (next !== confirm) return setError(t("login.passwordMismatch"));
    setError(null);
    setBusy(true);
    const result = await confirmPasswordReset(token, next);
    setBusy(false);
    if (result === "ok") {
      showSuccess(t("login.reset.done"));
      onDone();
      return;
    }
    setError(
      t(
        result === "expired"
          ? "login.reset.expired"
          : "login.serverUnavailable",
      ),
    );
  };
  return (
    <form onSubmit={submit} class="space-y-4">
      <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
        {t("login.reset.title")}
      </h2>
      <label class="block">
        <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
          {t("login.newPassword")}
        </span>
        <input
          type="password"
          autoComplete="new-password"
          // biome-ignore lint/a11y/noAutofocus: the one thing to do on this step
          autoFocus
          value={next}
          onInput={(e) => setNext((e.currentTarget as HTMLInputElement).value)}
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
          value={confirm}
          onInput={(e) =>
            setConfirm((e.currentTarget as HTMLInputElement).value)
          }
          class={inputClass}
        />
      </label>
      {error && (
        <p class="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} class={submitClass}>
        {t("login.reset.submit")}
      </button>
      <button type="button" class={quietClass} onClick={onDone}>
        {t("login.back")}
      </button>
    </form>
  );
}
