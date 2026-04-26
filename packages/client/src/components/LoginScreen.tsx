import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import { login, register, SERVER_URL } from "../state/auth.js";

type Mode = "signIn" | "register";

export function LoginScreen() {
  const [mode, setMode] = useState<Mode>("signIn");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function localValidationError(): string | null {
    if (username.trim().length === 0) return t("login.usernameRequired");
    if (password.length === 0) return t("login.passwordRequired");
    if (mode === "register" && password.length < 8) {
      return t("login.passwordTooShort");
    }
    return null;
  }

  async function onSubmit(event: Event) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    const validation = localValidationError();
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "signIn") {
        await login(username, password);
      } else {
        await register(username, password);
      }
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : t("login.errorGeneric");
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  function tabClass(active: boolean): string {
    return [
      "flex-1 py-2 text-sm font-medium border-b-2 transition-colors",
      active
        ? "border-blue-500 text-blue-700 dark:text-blue-300"
        : "border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200",
    ].join(" ");
  }

  return (
    <div class="min-h-dvh flex items-center justify-center px-4 py-8 bg-neutral-50 dark:bg-neutral-900">
      <div class="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-800 shadow-lg border border-neutral-200 dark:border-neutral-700 p-6">
        <h1 class="text-2xl font-semibold text-center mb-1 text-neutral-900 dark:text-neutral-50">
          {t("app.name")}
        </h1>
        <p class="text-sm text-center text-neutral-500 dark:text-neutral-400 mb-6">
          {t("login.title")}
        </p>

        <div class="flex mb-6 border-b border-neutral-200 dark:border-neutral-700">
          <button
            type="button"
            class={tabClass(mode === "signIn")}
            onClick={() => {
              setMode("signIn");
              setError(null);
            }}
          >
            {t("login.tabSignIn")}
          </button>
          <button
            type="button"
            class={tabClass(mode === "register")}
            onClick={() => {
              setMode("register");
              setError(null);
            }}
          >
            {t("login.tabRegister")}
          </button>
        </div>

        <form onSubmit={onSubmit} class="space-y-4">
          <label class="block">
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
              {t("login.username")}
            </span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onInput={(e) =>
                setUsername((e.currentTarget as HTMLInputElement).value)
              }
              class="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label class="block">
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
              {t("login.password")}
            </span>
            <input
              type="password"
              autoComplete={
                mode === "signIn" ? "current-password" : "new-password"
              }
              value={password}
              onInput={(e) =>
                setPassword((e.currentTarget as HTMLInputElement).value)
              }
              class="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          {error && (
            <p class="text-sm text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            class="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2 transition-colors"
          >
            {submitting
              ? t("login.submitting")
              : mode === "signIn"
                ? t("login.submitSignIn")
                : t("login.submitRegister")}
          </button>
        </form>

        {SERVER_URL && (
          <p class="mt-6 text-xs text-center text-neutral-400 dark:text-neutral-500 break-all">
            {t("login.serverLabel")}: {SERVER_URL}
          </p>
        )}
      </div>
    </div>
  );
}
