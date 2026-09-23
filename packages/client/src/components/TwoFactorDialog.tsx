import type { TwoFactorStatusResponse } from "@manifesto/shared";
import { Copy } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { type MessageKey, t } from "../i18n/index.js";
import { currentUser } from "../state/auth.js";
import {
  beginTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  groupSecret,
  otpauthLink,
  renewRecoveryCodes,
  twoFactorStatus,
} from "../state/twoFactor.js";
import { showSuccess } from "../state/ui.js";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";
const primaryClass =
  "px-4 py-2 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";
const secondaryClass =
  "px-4 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer";

type Step =
  | { kind: "loading" }
  | { kind: "status"; status: TwoFactorStatusResponse }
  | { kind: "password"; purpose: "begin" | "disable" | "renew" }
  | { kind: "scan"; secret: string }
  | { kind: "codes"; codes: string[] };

const FAILURE_KEYS: Record<string, MessageKey> = {
  "wrong-password": "twoFactor.wrongPassword",
  "wrong-code": "twoFactor.wrongCode",
  failed: "twoFactor.failed",
};

/**
 * Two-factor sign-in for a local account: turn it on (password, then the
 * secret into an authenticator, then a code to prove it took), keep the
 * recovery codes it hands out once, or turn it off with the password.
 */
export function TwoFactorDialog({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const load = async () => {
    const status = await twoFactorStatus();
    if (status) setStep({ kind: "status", status });
    else {
      setError(t("twoFactor.failed"));
      setStep({
        kind: "status",
        status: { enabled: false, recoveryCodesRemaining: 0 },
      });
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async <T extends { kind: string }>(
    action: () => Promise<T>,
    onOk: (result: T) => void,
  ) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.kind === "ok") onOk(result);
    else setError(t(FAILURE_KEYS[result.kind] ?? "twoFactor.failed"));
  };

  const submitPassword =
    (purpose: "begin" | "disable" | "renew") => (e: Event) => {
      e.preventDefault();
      if (purpose === "begin") {
        void run(
          () => beginTwoFactor(password),
          (r) => {
            setPassword("");
            setCode("");
            setStep({ kind: "scan", secret: (r as { secret: string }).secret });
          },
        );
      } else if (purpose === "disable") {
        void run(
          () => disableTwoFactor(password),
          () => {
            setPassword("");
            showSuccess(t("twoFactor.turnedOff"));
            void load();
          },
        );
      } else {
        void run(
          () => renewRecoveryCodes(password),
          (r) => {
            setPassword("");
            setStep({
              kind: "codes",
              codes: (r as { recoveryCodes: string[] }).recoveryCodes,
            });
          },
        );
      }
    };

  const submitCode = (e: Event) => {
    e.preventDefault();
    void run(
      () => enableTwoFactor(code.trim()),
      (r) => {
        showSuccess(t("twoFactor.turnedOn"));
        setStep({
          kind: "codes",
          codes: (r as { recoveryCodes: string[] }).recoveryCodes,
        });
      },
    );
  };

  const username = currentUser.value?.username ?? "";

  const errorLine = error && (
    <p class="text-sm text-red-600 dark:text-red-400" role="alert">
      {error}
    </p>
  );

  let body = null;
  if (step.kind === "loading") {
    body = <p class="text-sm text-neutral-500">{t("twoFactor.loading")}</p>;
  } else if (step.kind === "status") {
    const { enabled, recoveryCodesRemaining } = step.status;
    body = (
      <div class="space-y-3">
        <p class="text-sm">
          {enabled
            ? t("twoFactor.isOn", { count: String(recoveryCodesRemaining) })
            : t("twoFactor.isOff")}
        </p>
        {errorLine}
        <div class="flex flex-wrap justify-end gap-2">
          {enabled ? (
            <>
              <button
                type="button"
                class={secondaryClass}
                onClick={() => setStep({ kind: "password", purpose: "renew" })}
              >
                {t("twoFactor.newCodes")}
              </button>
              <button
                type="button"
                class={secondaryClass}
                onClick={() =>
                  setStep({ kind: "password", purpose: "disable" })
                }
              >
                {t("twoFactor.turnOff")}
              </button>
            </>
          ) : (
            <button
              type="button"
              class={primaryClass}
              onClick={() => setStep({ kind: "password", purpose: "begin" })}
            >
              {t("twoFactor.turnOn")}
            </button>
          )}
        </div>
      </div>
    );
  } else if (step.kind === "password") {
    body = (
      <form onSubmit={submitPassword(step.purpose)} class="space-y-3">
        <label class="block">
          <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("twoFactor.password")}
          </span>
          <input
            type="password"
            autoComplete="current-password"
            // biome-ignore lint/a11y/noAutofocus: the one thing to do on this step
            autoFocus
            value={password}
            onInput={(e) =>
              setPassword((e.currentTarget as HTMLInputElement).value)
            }
            class={inputClass}
          />
        </label>
        {errorLine}
        <div class="flex justify-end">
          <button type="submit" disabled={busy} class={primaryClass}>
            {t("twoFactor.continue")}
          </button>
        </div>
      </form>
    );
  } else if (step.kind === "scan") {
    body = (
      <form onSubmit={submitCode} class="space-y-3">
        <p class="text-sm">{t("twoFactor.addToApp")}</p>
        <p class="font-mono text-sm break-all select-all rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3">
          {groupSecret(step.secret)}
        </p>
        <p class="text-sm">
          <a
            class="underline text-blue-700 dark:text-blue-300"
            href={otpauthLink(username, step.secret)}
          >
            {t("twoFactor.openInApp")}
          </a>
        </p>
        <label class="block">
          <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("twoFactor.code")}
          </span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            value={code}
            onInput={(e) =>
              setCode((e.currentTarget as HTMLInputElement).value)
            }
            class={`${inputClass} tracking-widest`}
          />
        </label>
        {errorLine}
        <div class="flex justify-end">
          <button type="submit" disabled={busy} class={primaryClass}>
            {t("twoFactor.confirm")}
          </button>
        </div>
      </form>
    );
  } else {
    const text = step.codes.join("\n");
    body = (
      <div class="space-y-3">
        <p class="text-sm">{t("twoFactor.recoveryHint")}</p>
        <ul class="grid grid-cols-2 gap-1 font-mono text-sm rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3 select-all">
          {step.codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class={`${secondaryClass} inline-flex items-center gap-1.5`}
            onClick={() => {
              void navigator.clipboard
                ?.writeText(text)
                .then(() => showSuccess(t("twoFactor.copied")))
                .catch(() => {});
            }}
          >
            <Copy class="w-4 h-4" />
            {t("twoFactor.copy")}
          </button>
          <button
            type="button"
            class={primaryClass}
            onClick={() => void load()}
          >
            {t("twoFactor.saved")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div
        class="fixed inset-0 bg-black/50 z-40 animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="two-factor-title"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none animate-scale-in"
      >
        <div class="pointer-events-auto w-full max-w-sm max-h-full overflow-y-auto rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xl border border-neutral-200 dark:border-neutral-700 p-6 space-y-4">
          <div>
            <h2 id="two-factor-title" class="text-lg font-semibold">
              {t("twoFactor.title")}
            </h2>
            <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {t("twoFactor.hint")}
            </p>
          </div>
          {body}
          <div class="flex justify-end border-t border-neutral-200 dark:border-neutral-700 pt-3">
            <button type="button" class={secondaryClass} onClick={onClose}>
              {t("twoFactor.close")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
