import { KeyRound } from "lucide-preact";
import { useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  login,
  loginErrorKey,
  PasswordChangeRequiredError,
  register,
  signInWithPasskey,
  TwoFactorRequiredError,
} from "../state/auth.js";
import { getPasskey } from "../utils/webauthn.js";
import {
  ChangePasswordStep,
  type SecondFactor,
  TwoFactorStep,
} from "./LoginSteps.js";
import { inputClass, quietClass, submitClass } from "./loginFormClasses.js";

/**
 * `changePassword` is the step after signing in with a temporary password an
 * admin issued: the server answers with no session until a new one is chosen,
 * so the username and password typed a moment ago are kept and sent again
 * with it.
 */
type Mode = "signIn" | "register" | "changePassword" | "twoFactor";

/**
 * `canRegister` is false only when the server says registration is closed; an
 * older server does not say, so the tab stays and the server refuses instead.
 */
export function LocalLoginForm({
  onForgot,
  canRegister,
  passkeys,
}: {
  onForgot?: () => void;
  canRegister: boolean;
  /** Whether the server and this browser can sign in with a passkey. */
  passkeys: boolean;
}) {
  const [mode, setMode] = useState<Mode>("signIn");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [secondFactor, setSecondFactor] = useState<SecondFactor>({
    authenticator: true,
    passkey: null,
  });
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
        setSecondFactor({
          authenticator: err.authenticator,
          passkey: err.passkey,
        });
        setMode("twoFactor");
        return;
      }
      setError(t(loginErrorKey(err, mode)));
    } finally {
      setSubmitting(false);
    }
  }

  /** The second factor by passkey, answering the challenge the password got. */
  async function answerWithPasskey() {
    const options = secondFactor.passkey;
    if (!options || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const answer = await getPasskey(options);
      // A dismissed prompt leaves the challenge unspent, to try again.
      if (answer === "cancelled") return;
      if (typeof answer === "string") {
        setError(t("login.passkeyFailed"));
        return;
      }
      await login(username, password, undefined, undefined, answer);
    } catch (err) {
      if (err instanceof PasswordChangeRequiredError) {
        setNewPassword("");
        setConfirmPassword("");
        setMode("changePassword");
        return;
      }
      setError(t("login.passkeyFailed"));
      // That challenge is spent; the password again brings a fresh one.
      try {
        await login(username, password);
      } catch (again) {
        if (again instanceof TwoFactorRequiredError) {
          setSecondFactor({
            authenticator: again.authenticator,
            passkey: again.passkey,
          });
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function passkeySignIn() {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    const result = await signInWithPasskey();
    setSubmitting(false);
    if (result === "unknown") setError(t("login.passkeyUnknown"));
    else if (result === "failed") setError(t("login.passkeyFailed"));
  }

  function tabClass(active: boolean): string {
    return [
      "flex-1 py-2 text-sm font-medium border-b-2 transition-colors",
      active
        ? "border-blue-500 text-blue-700 dark:text-blue-300"
        : "border-transparent text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200",
    ].join(" ");
  }

  const backToSignIn = () => {
    setMode("signIn");
    setPassword("");
    setError(null);
  };

  if (mode === "twoFactor") {
    return (
      <TwoFactorStep
        secondFactor={secondFactor}
        otp={otp}
        setOtp={setOtp}
        error={error}
        submitting={submitting}
        onSubmit={onSubmit}
        onPasskey={() => void answerWithPasskey()}
        onBack={backToSignIn}
      />
    );
  }

  if (mode === "changePassword") {
    return (
      <ChangePasswordStep
        username={username}
        newPassword={newPassword}
        setNewPassword={setNewPassword}
        confirmPassword={confirmPassword}
        setConfirmPassword={setConfirmPassword}
        error={error}
        submitting={submitting}
        onSubmit={onSubmit}
        onBack={backToSignIn}
      />
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
            class={inputClass}
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
            class={inputClass}
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

        <button type="submit" disabled={submitting} class={submitClass}>
          {submitting
            ? t("login.submitting")
            : mode === "signIn"
              ? t("login.submitSignIn")
              : t("login.submitRegister")}
        </button>
        {mode === "signIn" && passkeys && (
          <button
            type="button"
            disabled={submitting}
            class={`${quietClass} inline-flex items-center justify-center gap-1.5`}
            onClick={() => void passkeySignIn()}
          >
            <KeyRound class="w-4 h-4" />
            {t("login.withPasskey")}
          </button>
        )}
        {mode === "signIn" && onForgot && (
          <button type="button" class={quietClass} onClick={onForgot}>
            {t("login.forgot.link")}
          </button>
        )}
      </form>
    </>
  );
}
