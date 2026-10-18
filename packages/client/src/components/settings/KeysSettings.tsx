import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "#/components/ConfirmWithPassword.tsx";
import { KeepSheetStep } from "#/components/login/KeySheet.tsx";
import { QrCode } from "#/components/QrCode.tsx";
import { t } from "#/i18n/index.ts";
import {
  abandonRenewal,
  completeRenewal,
  prepareRecoveryKey,
  prepareSecretKey,
  revealSecretKey,
  secretKeyAddress,
  sheetFor,
} from "#/state/account/accountKeys.ts";
import type { ConfirmationRefusal } from "#/state/account/passwordConfirmation.ts";
import { SettingsHeading } from "./SettingsControls.tsx";

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
      <SettingsHeading>{title}</SettingsHeading>
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
 * A new key is shown before it is sent, and replaces the old one only once
 * the user says they kept it; the password is held until then, since the
 * server asks for it again with the new key.
 */
export function KeysSettings() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    abandonRenewal();
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
          ? await prepareSecretKey(password)
          : await prepareRecoveryKey(password);
    setBusy(false);
    if (result.kind === "failed") {
      setFailed(true);
      return;
    }
    if (result.kind !== "ok") {
      setRefusal(result.kind);
      return;
    }
    if (purpose === "reveal" && "secretKey" in result) {
      setPassword("");
      setStep({ kind: "revealed", secretKey: result.secretKey });
    } else if ("secretKey" in result) {
      setStep({ kind: "made", secretKey: result.secretKey });
    } else {
      setStep({ kind: "made", recoveryKey: result.recoveryKey });
    }
  };

  const keep = async () => {
    setRefusal(null);
    setFailed(false);
    setBusy(true);
    const result = await completeRenewal(password);
    setBusy(false);
    if (result.kind === "ok") {
      setPassword("");
      setStep({ kind: "idle" });
    } else if (result.kind === "failed") {
      setFailed(true);
    } else {
      setRefusal(result.kind);
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
          <button
            type="button"
            class={buttonClass("secondary")}
            onClick={reset}
          >
            {t("confirm.cancel")}
          </button>
          <button type="submit" disabled={busy} class={buttonClass("primary")}>
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
          <button type="button" class={buttonClass("primary")} onClick={reset}>
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
        <KeepSheetStep
          sheet={sheetFor(step)}
          submitLabel={t("keys.settings.kept")}
          error={
            <>
              {refusal && <ConfirmationError refusal={refusal} />}
              {failed && (
                <p class="text-sm text-red-600 dark:text-red-400" role="alert">
                  {t("keys.failed")}
                </p>
              )}
            </>
          }
          busy={busy}
          onSubmit={() => void keep()}
        />
        <div class="flex justify-end">
          <button
            type="button"
            class={buttonClass("secondary")}
            onClick={reset}
          >
            {t("confirm.cancel")}
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
            class={buttonClass("secondary")}
            onClick={() => ask("newSecret")}
          >
            {t("keys.settings.newSecret")}
          </button>
          <button
            type="button"
            class={buttonClass("primary")}
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
            class={buttonClass("secondary")}
            onClick={() => ask("newRecovery")}
          >
            {t("keys.settings.newRecovery")}
          </button>
        </div>
      </Section>
    </div>
  );
}
