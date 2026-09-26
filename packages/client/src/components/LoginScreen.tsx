import type { AuthMethodsResponse } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import { APP_LOGO, APP_NAME, INSTANCE_NAME } from "../config.js";
import { type MessageKey, t } from "../i18n/index.js";
import {
  confirmPasswordReset,
  fetchAuthMethods,
  login,
  loginErrorKey,
  type OidcRefusal,
  oidcLoginUrl,
  oidcRefusal,
  PasswordChangeRequiredError,
  register,
  requestPasswordReset,
  SERVER_ORIGIN,
  TwoFactorRequiredError,
  takeResetToken,
} from "../state/auth.js";
import { locale } from "../state/prefs.js";
import { showSuccess } from "../state/ui.js";
import { BrandLogo } from "./BrandLogo.js";
import { OrgCredit } from "./OrgCredit.js";

const OIDC_REFUSAL_MESSAGES: Record<OidcRefusal, MessageKey> = {
  not_in_group: "login.oidcNotInGroup",
  not_registered: "login.oidcNotRegistered",
  groups_unavailable: "login.oidcGroupsUnavailable",
};

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
        <BrandLogo logo={APP_LOGO} class="h-12 w-12 mx-auto mb-4" />
        {/* No "Sign in to…" beneath: the name is the heading, and the form
            under it starts with a Sign in tab. */}
        <h1
          class={`text-2xl font-semibold text-center text-neutral-900 dark:text-neutral-50 ${INSTANCE_NAME ? "mb-1" : "mb-6"}`}
        >
          {APP_NAME}
        </h1>
        {INSTANCE_NAME && (
          <p class="text-sm text-center mb-6 text-neutral-500 dark:text-neutral-400">
            {INSTANCE_NAME}
          </p>
        )}

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
        {discovery.kind === "ready" && (
          <SignInOptions methods={discovery.methods} />
        )}

        <OrgCredit class="mt-6" />

        {SERVER_ORIGIN !== null && (
          <p class="mt-6 text-xs text-center text-neutral-400 dark:text-neutral-500 break-all">
            {t("login.serverLabel")}: {SERVER_ORIGIN}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Whichever ways in the server offers. With both, single sign-on comes first,
 * and the password form follows it, or waits behind a link when the server
 * keeps local accounts only as a spare key.
 */
function SignInOptions({ methods }: { methods: AuthMethodsResponse }) {
  const providers = methods.providers ?? [methods.provider];
  const collapsed = methods.passwordForm === "collapsed";
  const [showPassword, setShowPassword] = useState(!collapsed);
  const [resetToken, setResetToken] = useState<string | null>(() =>
    takeResetToken(),
  );
  const [forgot, setForgot] = useState(false);
  const oidc = providers.includes("oidc");
  const local = providers.includes("local");
  if (resetToken && local) {
    return (
      <ResetPasswordForm
        token={resetToken}
        onDone={() => setResetToken(null)}
      />
    );
  }
  if (forgot) return <ForgotPasswordForm onBack={() => setForgot(false)} />;
  return (
    <>
      {oidc && <OidcLoginPanel />}
      {oidc && local && (
        <div class="my-5 flex items-center gap-3 text-xs text-neutral-400 dark:text-neutral-500">
          <span class="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
          {t("login.or")}
          <span class="flex-1 border-t border-neutral-200 dark:border-neutral-700" />
        </div>
      )}
      {local &&
        (showPassword || !oidc ? (
          <LocalLoginForm
            onForgot={methods.passwordReset ? () => setForgot(true) : undefined}
            canRegister={methods.registration !== false}
          />
        ) : (
          <button
            type="button"
            class="w-full text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200"
            onClick={() => setShowPassword(true)}
          >
            {t("login.withPassword")}
          </button>
        ))}
    </>
  );
}

function OidcLoginPanel() {
  const href = oidcLoginUrl ?? "#";
  const refusal = oidcRefusal.value;
  return (
    <div class="space-y-4 py-2">
      {refusal && (
        <p
          class="text-sm text-center text-red-600 dark:text-red-400"
          role="alert"
        >
          {t(OIDC_REFUSAL_MESSAGES[refusal])}
        </p>
      )}
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

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";
const submitClass =
  "w-full rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-medium py-2 transition-colors";
const quietClass =
  "w-full text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200";

/** Asks for a reset link by mail; says the same whatever the address. */
function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
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
function ResetPasswordForm({
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

/**
 * `canRegister` is false only when the server says registration is closed; an
 * older server does not say, so the tab stays and the server refuses instead.
 */
function LocalLoginForm({
  onForgot,
  canRegister,
}: {
  onForgot?: () => void;
  canRegister: boolean;
}) {
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
      {canRegister && (
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
      )}

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
        {mode === "signIn" && onForgot && (
          <button type="button" class={quietClass} onClick={onForgot}>
            {t("login.forgot.link")}
          </button>
        )}
      </form>
    </>
  );
}
