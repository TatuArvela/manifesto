import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "../i18n/index.js";
import {
  AuthRequestError,
  loginErrorKey,
  requestSignInLink,
  signInWithLink,
  TwoFactorRequiredError,
} from "../state/auth.js";
import { locale } from "../state/prefs.js";
import { getPasskey } from "../utils/webauthn.js";
import { type SecondFactor, TwoFactorStep } from "./LoginSteps.js";
import { inputClass, quietClass, submitClass } from "./loginFormClasses.js";

/** Asks for a sign-in link by mail; says the same whatever the address. */
export function SignInLinkForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(
    "idle",
  );
  const submit = async (event: Event) => {
    event.preventDefault();
    if (state === "sending" || email.trim().length === 0) return;
    setState("sending");
    const ok = await requestSignInLink(email.trim(), locale.value);
    setState(ok ? "sent" : "failed");
  };
  return (
    <form onSubmit={submit} class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t("login.link.title")}
        </h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {state === "sent" ? t("login.link.sent") : t("login.link.hint")}
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

/**
 * Where a mailed sign-in link lands. It signs in at once, since opening the
 * link was the decision; an account with a second factor is asked for it
 * first, with the same link, which the server only spends once that holds.
 */
export function SignInLinkLanding({
  token,
  onDone,
}: {
  token: string;
  /** Back to the ordinary sign-in form, the link being of no more use. */
  onDone: () => void;
}) {
  const [step, setStep] = useState<"working" | "twoFactor" | "expired">(
    "working",
  );
  const [secondFactor, setSecondFactor] = useState<SecondFactor>({
    authenticator: true,
    passkey: null,
  });
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** One attempt with the link. A success signs in, and this screen goes. */
  const attempt = async (
    code?: string,
    passkey?: Parameters<typeof signInWithLink>[2],
  ) => {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithLink(token, code, passkey);
    } catch (err) {
      if (err instanceof TwoFactorRequiredError) {
        setSecondFactor({
          authenticator: err.authenticator,
          passkey: err.passkey,
        });
        setStep("twoFactor");
      } else if (err instanceof AuthRequestError && err.status === 410) {
        setStep("expired");
      } else if (passkey !== undefined) {
        setError(t("login.passkeyFailed"));
        // That challenge is spent; the link again brings a fresh one.
        try {
          await signInWithLink(token);
        } catch (again) {
          if (again instanceof TwoFactorRequiredError) {
            setSecondFactor({
              authenticator: again.authenticator,
              passkey: again.passkey,
            });
          }
        }
      } else if (code !== undefined) {
        setError(t(loginErrorKey(err, "twoFactor")));
      } else {
        setError(t(loginErrorKey(err, "signIn")));
        setStep("expired");
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Once, on arrival. A ref rather than the dependency list: the effect must
  // not run again when `attempt` is rebuilt, or the link would be tried twice.
  const started = useRef(false);
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void attemptRef.current();
  }, []);

  const answerWithPasskey = async () => {
    const options = secondFactor.passkey;
    if (!options || submitting) return;
    const answer = await getPasskey(options);
    // A dismissed prompt leaves the challenge unspent, to try again.
    if (answer === "cancelled") return;
    if (typeof answer === "string") {
      setError(t("login.passkeyFailed"));
      return;
    }
    await attempt(undefined, answer);
  };

  if (step === "twoFactor") {
    return (
      <TwoFactorStep
        secondFactor={secondFactor}
        otp={otp}
        setOtp={setOtp}
        error={error}
        submitting={submitting}
        onSubmit={(event) => {
          event.preventDefault();
          if (submitting) return;
          if (otp.trim().length === 0) {
            setError(t("login.twoFactorRequired"));
            return;
          }
          void attempt(otp.trim());
        }}
        onPasskey={() => void answerWithPasskey()}
        onBack={onDone}
      />
    );
  }

  return (
    <div class="space-y-4">
      <p
        class="text-sm text-center text-neutral-600 dark:text-neutral-300"
        role={step === "expired" ? "alert" : "status"}
      >
        {step === "expired"
          ? (error ?? t("login.link.expired"))
          : t("login.link.signingIn")}
      </p>
      {step === "expired" && (
        <button type="button" class={quietClass} onClick={onDone}>
          {t("login.back")}
        </button>
      )}
    </div>
  );
}
