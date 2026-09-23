import type { AuthMethodsResponse } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import { APP_LOGO_URL, APP_NAME } from "../config.js";
import { t } from "../i18n/index.js";
import {
  fetchAuthMethods,
  login,
  loginErrorKey,
  oidcLoginUrl,
  PasswordChangeRequiredError,
  register,
  SERVER_ORIGIN,
  TwoFactorRequiredError,
} from "../state/auth.js";

/**
 * `changePassword` is the step after signing in with a temporary password an
 * admin issued: the server answers with no session until a new one is chosen,
 * so the username and password typed a moment ago are kept and sent again
 * with it.
 */
type Mode = "signIn" | "register" | "changePassword" | "twoFactor";

type DiscoveryState =
  | { kind: "loading" }
  | { kind: "ready"; methods: AuthMethodsResponse }
  | { kind: "unavailable" };

export function LoginScreen() {
  const [discovery, setDiscovery] = useState<DiscoveryState>({
    kind: "loading",
  });

  useEffect(() => {
    let cancelled = false;
    void fetchAuthMethods().then((methods) => {
      if (cancelled) return;
      if (!methods) {
        setDiscovery({ kind: "unavailable" });
        return;
      }
      setDiscovery({ kind: "ready", methods });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div class="min-h-dvh flex items-center justify-center px-4 py-8 bg-neutral-50 dark:bg-neutral-900">
      <div class="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-800 shadow-lg border border-neutral-200 dark:border-neutral-700 p-6">
        {/* Decorative: the name follows immediately below as real text. */}
        <img
          src={APP_LOGO_URL}
          alt=""
          class="h-12 w-12 mx-auto mb-4 dark:invert"
        />
        {/* No "Sign in to…" beneath: the name is the heading, and the form
            under it starts with a Sign in tab. */}
        <h1 class="text-2xl font-semibold text-center mb-6 text-neutral-900 dark:text-neutral-50">
          {APP_NAME}
        </h1>

        {discovery.kind === "loading" && (
          <p class="text-sm text-center text-neutral-500 dark:text-neutral-400 py-6">
            {t("login.loading")}
          </p>
        )}
        {discovery.kind === "unavailable" && (
          <p
            class="text-sm text-center text-red-600 dark:text-red-400 py-6"
            role="alert"
          >
            {t("login.serverUnavailable")}
          </p>
        )}
        {discovery.kind === "ready" &&
          discovery.methods.provider === "oidc" && <OidcLoginPanel />}
        {discovery.kind === "ready" &&
          discovery.methods.provider === "local" && <LocalLoginForm />}

        {SERVER_ORIGIN !== null && (
          <p class="mt-6 text-xs text-center text-neutral-400 dark:text-neutral-500 break-all">
            {t("login.serverLabel")}: {SERVER_ORIGIN}
          </p>
        )}
      </div>
    </div>
  );
}

function OidcLoginPanel() {
  const href = oidcLoginUrl ?? "#";
  return (
    <div class="space-y-4 py-2">
      <p class="text-sm text-center text-neutral-600 dark:text-neutral-300">
        {t("login.oidcHint")}
      </p>
      <a
        href={href}
        class="block w-full text-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 transition-colors"
      >
        {t("login.oidcSubmit")}
      </a>
    </div>
  );
}

function LocalLoginForm() {
  const [mode, setMode] = useState<Mode>("signIn");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function localValidationError(): string | null {
    if (mode === "twoFactor") {
      return otp.trim().length === 0 ? t("login.twoFactorRequired") : null;
    }
    if (mode === "changePassword") {
      if (newPassword.length < 8) return t("login.passwordTooShort");
      if (newPassword !== confirmPassword) return t("login.passwordMismatch");
      if (newPassword === password) return t("login.samePassword");
      return null;
    }
    if (username.trim().length === 0) return t("login.usernameRequired");
    if (password.length === 0) return t("login.passwordRequired");
    if (mode === "register" && password.length < 8) {
      return t("login.passwordTooShort");
    }
    if (
      mode === "register" &&
      email.trim().length > 0 &&
      !/^[^\s@]+@[^\s@]+$/.test(email.trim())
    ) {
      return t("account.email.invalid");
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
      } else if (mode === "changePassword") {
        await login(username, password, newPassword);
      } else if (mode === "twoFactor") {
        await login(username, password, undefined, otp.trim());
      } else {
        await register(username, password, email.trim() || undefined);
      }
    } catch (err) {
      if (err instanceof PasswordChangeRequiredError) {
        setNewPassword("");
        setConfirmPassword("");
        setMode("changePassword");
        return;
      }
      if (err instanceof TwoFactorRequiredError) {
        setOtp("");
        setMode("twoFactor");
        return;
      }
      setError(t(loginErrorKey(err, mode)));
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

  const inputClass =
    "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

  if (mode === "twoFactor") {
    return (
      <form onSubmit={onSubmit} class="space-y-4">
        <div>
          <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
            {t("login.twoFactor.title")}
          </h2>
          <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
            {t("login.twoFactor.hint")}
          </p>
        </div>
        <label class="block">
          <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("login.twoFactor.code")}
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
        <button
          type="submit"
          disabled={submitting}
          class="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2 transition-colors"
        >
          {submitting ? t("login.submitting") : t("login.twoFactor.submit")}
        </button>
        <button
          type="button"
          class="w-full text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
          onClick={() => {
            setMode("signIn");
            setPassword("");
            setError(null);
          }}
        >
          {t("login.back")}
        </button>
      </form>
    );
  }

  if (mode === "changePassword") {
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

        <button
          type="submit"
          disabled={submitting}
          class="w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2 transition-colors"
        >
          {submitting ? t("login.submitting") : t("login.submitChangePassword")}
        </button>
        <button
          type="button"
          class="w-full text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
          onClick={() => {
            setMode("signIn");
            setPassword("");
            setError(null);
          }}
        >
          {t("login.back")}
        </button>
      </form>
    );
  }

  return (
    <>
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
        {mode === "register" && (
          <label class="block">
            <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
              {t("login.emailOptional")}
            </span>
            <input
              type="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onInput={(e) =>
                setEmail((e.currentTarget as HTMLInputElement).value)
              }
              class={inputClass}
            />
            <span class="block mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t("account.email.hint")}
            </span>
          </label>
        )}

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
    </>
  );
}
