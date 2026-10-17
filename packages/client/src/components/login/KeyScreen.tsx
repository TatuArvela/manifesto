import { useEffect, useState } from "preact/hooks";
import { APP_LOGO, APP_NAME } from "../../config.js";
import { type MessageKey, t } from "../../i18n/index.js";
import {
  checkAccountKeys,
  completeSetup,
  type KeySheet,
  keyState,
  prepareSetup,
  startAgain,
  type UnlockResult,
  unlock,
} from "../../state/account/accountKeys.js";
import { currentUser } from "../../state/account/auth.js";
import type { ConfirmationRefusal } from "../../state/account/passwordConfirmation.js";
import { signOut } from "../../state/account/signOut.js";
import { userKeyKindOf } from "../../utils/userKey.js";
import { BrandLogo } from "../BrandLogo.js";
import { buttonClass } from "../buttonClasses.js";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "../ConfirmWithPassword.js";
import { KeepSheetStep } from "./KeySheet.js";
import { quietClass, submitClass } from "./loginFormClasses.js";
import { Field, RecoveryForm, UserKeyInput } from "./RecoveryForms.js";

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">
      {message}
    </p>
  );
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div>
      <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
        {title}
      </h2>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{hint}</p>
    </div>
  );
}

/**
 * What a signed-in account sees until its notes are unlocked: the set-up of
 * its keys the first time, and after that the secret key asked for at every
 * sign-in. Signing in proved who it is; this is what opens the notes.
 */
export function KeyScreen() {
  const state = keyState.value;
  const user = currentUser.value;
  return (
    <div class="min-h-dvh flex items-center justify-center px-4 py-8 bg-neutral-50 dark:bg-neutral-900">
      <div class="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-800 shadow-lg border border-neutral-200 dark:border-neutral-700 p-6">
        <BrandLogo logo={APP_LOGO} class="h-12 w-12 mx-auto mb-4" />
        <h1 class="text-2xl font-semibold text-center text-neutral-900 dark:text-neutral-50 mb-6">
          {APP_NAME}
        </h1>
        {state === "unsupported" && (
          <p class="text-sm text-center text-red-600 dark:text-red-400 py-4">
            {t("keys.unsupported")}
          </p>
        )}
        {state === "unavailable" && (
          <div class="space-y-4">
            <p
              class="text-sm text-center text-red-600 dark:text-red-400"
              role="alert"
            >
              {t("login.serverUnavailable")}
            </p>
            <button
              type="button"
              class={submitClass}
              onClick={() => void checkAccountKeys()}
            >
              {t("keys.retry")}
            </button>
          </div>
        )}
        {state === "setup" && <SetupKeys />}
        {state === "locked" && <UnlockKeys />}
        {state !== "unsupported" &&
          state !== "unavailable" &&
          state !== "setup" &&
          state !== "locked" && (
            <p class="text-sm text-center text-neutral-500 dark:text-neutral-400 py-6">
              {t("login.loading")}
            </p>
          )}
        {user && (
          <p class="mt-6 text-xs text-center text-neutral-500 dark:text-neutral-400">
            {t("keys.signedInAs", { name: user.username })}{" "}
            <button
              type="button"
              class="underline cursor-pointer"
              onClick={() => void signOut()}
            >
              {t("login.signOut")}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

/** An account's first sign-in: its keys are made here and shown once. */
function SetupKeys() {
  const [sheet, setSheet] = useState<KeySheet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void prepareSetup().then((made) => {
      if (!live) return;
      if (made) setSheet(made);
      else setError(t("keys.failed"));
    });
    return () => {
      live = false;
    };
  }, []);

  const finish = async () => {
    setError(null);
    setBusy(true);
    const result = await completeSetup();
    setBusy(false);
    if (result === "failed") setError(t("keys.failed"));
  };

  return (
    <div class="space-y-4">
      <Heading title={t("keys.setup.title")} hint={t("keys.setup.hint")} />
      {sheet ? (
        <KeepSheetStep
          sheet={sheet}
          submitLabel={t("keys.setup.finish")}
          error={<ErrorLine message={error} />}
          busy={busy}
          onSubmit={() => void finish()}
        />
      ) : (
        <ErrorLine message={error} />
      )}
    </div>
  );
}

const UNLOCK_FAILURES: Record<Exclude<UnlockResult, "ok">, MessageKey> = {
  invalid: "keys.unlock.invalid",
  wrong: "keys.unlock.wrong",
  failed: "keys.failed",
};

type UnlockMode = "unlock" | "recover" | "startAgain";

/** Every sign-in after the first: the secret key, or a way on without it. */
function UnlockKeys() {
  const [mode, setMode] = useState<UnlockMode>("unlock");
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (mode === "recover") {
    return (
      <RecoveryForm withUsername={false} onBack={() => setMode("unlock")} />
    );
  }
  if (mode === "startAgain") {
    return <StartAgain onBack={() => setMode("unlock")} />;
  }

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    if (userKeyKindOf(key) === "recovery") {
      setError(t("keys.unlock.isRecoveryKey"));
      return;
    }
    setError(null);
    setBusy(true);
    const result = await unlock(key);
    setBusy(false);
    if (result !== "ok") setError(t(UNLOCK_FAILURES[result]));
  };

  return (
    <form onSubmit={submit} class="space-y-4">
      <Heading title={t("keys.unlock.title")} hint={t("keys.unlock.hint")} />
      <Field label={t("keys.secretKey")}>
        <UserKeyInput
          value={key}
          onInput={setKey}
          placeholder="SK-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
        />
      </Field>
      <ErrorLine message={error} />
      <button type="submit" disabled={busy} class={submitClass}>
        {busy ? t("login.submitting") : t("keys.unlock.submit")}
      </button>
      <button
        type="button"
        class={quietClass}
        onClick={() => setMode("recover")}
      >
        {t("keys.unlock.useRecoveryKey")}
      </button>
      <button
        type="button"
        class={quietClass}
        onClick={() => setMode("startAgain")}
      >
        {t("keys.unlock.lostBoth")}
      </button>
    </form>
  );
}

/** For someone with neither key: the account's keys go, and it is set up
 * again. Said plainly, since nothing brings back what the old keys held. */
function StartAgain({ onBack }: { onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setRefusal(null);
    setBusy(true);
    const result = await startAgain(password);
    setBusy(false);
    if (result.kind === "ok") return;
    if (result.kind === "failed") setError(t("keys.failed"));
    else setRefusal(result.kind);
  };

  return (
    <form onSubmit={submit} class="space-y-4">
      <Heading
        title={t("keys.startAgain.title")}
        hint={t("keys.startAgain.hint")}
      />
      <ConfirmPasswordField value={password} onInput={setPassword} />
      {refusal && <ConfirmationError refusal={refusal} />}
      <ErrorLine message={error} />
      <button
        type="submit"
        disabled={busy}
        class={`${buttonClass("danger")} w-full`}
      >
        {busy ? t("login.submitting") : t("keys.startAgain.submit")}
      </button>
      <button type="button" class={quietClass} onClick={onBack}>
        {t("login.back")}
      </button>
    </form>
  );
}
