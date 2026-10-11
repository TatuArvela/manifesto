import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { t } from "../../i18n/index.js";
import {
  renewRecoveryKey,
  renewSecretKey,
  revealSecretKey,
  secretKeyAddress,
  sheetFor,
} from "../../state/accountKeys.js";
import type { ConfirmationRefusal } from "../../state/passwordConfirmation.js";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "../ConfirmWithPassword.js";
import { KeySheetView } from "../KeySheet.js";
import { QrCode } from "../QrCode.js";

const primaryClass =
  "px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";
const secondaryClass =
  "px-4 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer";

/** What each button asks the password for. */
type Purpose = "reveal" | "newSecret" | "newRecovery";

type Step =
  | { kind: "idle" }
  | { kind: "confirm"; purpose: Purpose }
  | { kind: "revealed"; secretKey: string }
  | { kind: "made"; secretKey?: string; recoveryKey?: string };

const CONFIRM_HINTS = {
  reveal: "keys.settings.revealHint",
  newSecret: "keys.settings.newSecretHint",
  newRecovery: "keys.settings.newRecoveryHint",
} as const;

function Section({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="space-y-3">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 pb-1.5 border-b border-neutral-200 dark:border-neutral-700">
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * The two keys an account's notes are opened with. The secret key is on this
 * device, so it can be shown, to type or scan on another one; the recovery key
 * is on the sheet alone, so it can only be replaced. Each step asks for the
 * password first (or a recent sign-in), since a session left open should not
 * be enough to read a key off the screen or to lock every other device out.
 */
export function KeysSettings() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setRefusal(null);
    setFailed(false);
  };

  const ask = (purpose: Purpose) => {
    reset();
    setStep({ kind: "confirm", purpose });
  };

  const submit = (purpose: Purpose) => async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setRefusal(null);
    setFailed(false);
    setBusy(true);
    const result =
      purpose === "reveal"
        ? await revealSecretKey(password)
        : purpose === "newSecret"
          ? await renewSecretKey(password)
          : await renewRecoveryKey(password);
    setBusy(false);
    if (result.kind === "failed") {
      setFailed(true);
      return;
    }
    if (result.kind !== "ok") {
      setRefusal(result.kind);
      return;
    }
    setPassword("");
    if (purpose === "reveal" && "secretKey" in result) {
      setStep({ kind: "revealed", secretKey: result.secretKey });
    } else if ("secretKey" in result) {
      setStep({ kind: "made", secretKey: result.secretKey });
    } else {
      setStep({ kind: "made", recoveryKey: result.recoveryKey });
    }
  };

  if (step.kind === "confirm") {
    return (
      <form onSubmit={submit(step.purpose)} class="space-y-4">
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {t(CONFIRM_HINTS[step.purpose])}
        </p>
        <ConfirmPasswordField value={password} onInput={setPassword} />
        {refusal && <ConfirmationError refusal={refusal} />}
        {failed && (
          <p class="text-sm text-red-600 dark:text-red-400" role="alert">
            {t("keys.failed")}
          </p>
        )}
        <div class="flex justify-end gap-2">
          <button type="button" class={secondaryClass} onClick={reset}>
            {t("confirm.cancel")}
          </button>
          <button type="submit" disabled={busy} class={primaryClass}>
            {t("keys.continue")}
          </button>
        </div>
      </form>
    );
  }

  if (step.kind === "revealed") {
    return (
      <div class="space-y-4">
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {t("keys.settings.revealed")}
        </p>
        <p class="font-mono text-sm tracking-wide break-all select-all rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3">
          {step.secretKey}
        </p>
        <div class="flex justify-center">
          <QrCode
            value={secretKeyAddress(step.secretKey)}
            label={t("keys.settings.qrLabel")}
          />
        </div>
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {t("keys.settings.qrHint")}
        </p>
        <div class="flex justify-end">
          <button type="button" class={primaryClass} onClick={reset}>
            {t("keys.settings.hide")}
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === "made") {
    return (
      <div class="space-y-4">
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {t(
            step.secretKey
              ? "keys.settings.madeSecret"
              : "keys.settings.madeRecovery",
          )}
        </p>
        <KeySheetView sheet={sheetFor(step)} />
        <div class="flex justify-end">
          <button type="button" class={primaryClass} onClick={reset}>
            {t("keys.settings.kept")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="space-y-8">
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {t("keys.settings.hint")}
      </p>
      <Section title={t("keys.secretKey")}>
        <p class="text-sm">{t("keys.settings.secretAbout")}</p>
        <div class="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            class={secondaryClass}
            onClick={() => ask("newSecret")}
          >
            {t("keys.settings.newSecret")}
          </button>
          <button
            type="button"
            class={primaryClass}
            onClick={() => ask("reveal")}
          >
            {t("keys.settings.reveal")}
          </button>
        </div>
      </Section>
      <Section title={t("keys.recoveryKey")}>
        <p class="text-sm">{t("keys.settings.recoveryAbout")}</p>
        <div class="flex justify-end">
          <button
            type="button"
            class={secondaryClass}
            onClick={() => ask("newRecovery")}
          >
            {t("keys.settings.newRecovery")}
          </button>
        </div>
      </Section>
    </div>
  );
}
