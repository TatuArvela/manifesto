import { useEffect, useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "#/components/ConfirmWithPassword.tsx";
import { QrCode } from "#/components/QrCode.tsx";
import { t } from "#/i18n/index.ts";
import { createDeviceLink } from "#/state/account/deviceLinks.ts";
import type { ConfirmationRefusal } from "#/state/account/passwordConfirmation.ts";

type Step =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "shown"; address: string; expiresAt: number };

/** Whole minutes and seconds until `at`, as `4:05`. */
function remaining(at: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A QR code that signs in a second device, such as a phone, without typing the
 * password there. It asks for the password first, because a session that
 * stays open must not be sufficient to make a new one. The code works one
 * time, for a few minutes. When this device holds the secret key, the code
 * also carries it. Thus, the other device opens the notes immediately. An
 * account with a second factor gives it on the other device.
 */
export function DeviceLinkSettings() {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const shownUntil = step.kind === "shown" ? step.expiresAt : null;
  useEffect(() => {
    if (shownUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [shownUntil]);

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setRefusal(null);
    setFailed(false);
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setRefusal(null);
    setFailed(false);
    setBusy(true);
    const result = await createDeviceLink(password);
    setBusy(false);
    if (result.kind === "ok") {
      setPassword("");
      setNow(Date.now());
      setStep({
        kind: "shown",
        address: result.address,
        expiresAt: Date.parse(result.expiresAt),
      });
    } else if (result.kind === "failed") {
      setFailed(true);
    } else {
      setRefusal(result.kind);
    }
  };

  if (step.kind === "confirm") {
    return (
      <form onSubmit={submit} class="space-y-4">
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {t("deviceLink.confirmHint")}
        </p>
        <ConfirmPasswordField value={password} onInput={setPassword} />
        {refusal && <ConfirmationError refusal={refusal} />}
        {failed && (
          <p class="text-sm text-red-600 dark:text-red-400" role="alert">
            {t("deviceLink.failed")}
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
            {t("deviceLink.show")}
          </button>
        </div>
      </form>
    );
  }

  if (step.kind === "shown") {
    const expired = now >= step.expiresAt;
    return (
      <div class="space-y-4">
        {expired ? (
          <p
            class="text-sm text-neutral-600 dark:text-neutral-300"
            role="status"
          >
            {t("deviceLink.expired")}
          </p>
        ) : (
          <>
            <div class="flex justify-center">
              <QrCode value={step.address} label={t("deviceLink.qrLabel")} />
            </div>
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              {t("deviceLink.scanHint")}
            </p>
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {t("deviceLink.expiresIn", {
                time: remaining(step.expiresAt, now),
              })}
            </p>
          </>
        )}
        <div class="flex justify-end gap-2">
          {expired && (
            <button
              type="button"
              class={buttonClass("secondary")}
              onClick={() => setStep({ kind: "confirm" })}
            >
              {t("deviceLink.again")}
            </button>
          )}
          <button type="button" class={buttonClass("primary")} onClick={reset}>
            {t("keys.settings.hide")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="flex flex-col sm:flex-row sm:items-center gap-3">
      <p class="flex-1 text-sm text-neutral-500 dark:text-neutral-400">
        {t("deviceLink.hint")}
      </p>
      <button
        type="button"
        class={`${buttonClass("secondary", "sm")} self-end sm:self-auto shrink-0`}
        onClick={() => setStep({ kind: "confirm" })}
      >
        {t("deviceLink.open")}
      </button>
    </div>
  );
}
