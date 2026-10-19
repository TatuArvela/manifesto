import type { TwoFactorStatusResponse } from "@manifesto/shared";
import { useCallback, useEffect, useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import { QrCode } from "#/components/QrCode.tsx";
import { type MessageKey, t } from "#/i18n/index.ts";
import { currentUser } from "#/state/account/auth.ts";
import {
  beginTwoFactor,
  disableTwoFactor,
  enableTwoFactor,
  groupSecret,
  otpauthLink,
  twoFactorStatus,
} from "#/state/account/twoFactor.ts";
import { serverFeature } from "#/state/serverFeatures.ts";
import { showSuccess } from "#/state/ui.ts";
import { PasskeySettings } from "./PasskeySettings.tsx";

const inputClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-2 text-sm max-sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

type Step =
  | { kind: "loading" }
  | { kind: "status"; status: TwoFactorStatusResponse }
  | { kind: "password"; purpose: "begin" | "disable" }
  | { kind: "scan"; secret: string };

const FAILURE_KEYS: Record<string, MessageKey> = {
  "wrong-password": "twoFactor.wrongPassword",
  "wrong-code": "twoFactor.wrongCode",
  failed: "twoFactor.failed",
};

/**
 * Two-factor sign-in for a local account: an authenticator app (password,
 * then the secret into the app, then a code to prove it took), passkeys, or
 * both, and the password asked again to remove either. Whoever loses every
 * factor signs in with the recovery key, which the account's keys page holds.
 */
export function TwoFactorSettings() {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const status = await twoFactorStatus();
    if (status) setStep({ kind: "status", status });
    else {
      setError(t("twoFactor.failed"));
      setStep({
        kind: "status",
        status: { enabled: false },
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const submitPassword = (purpose: "begin" | "disable") => (e: Event) => {
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
    } else {
      void run(
        () => disableTwoFactor(password),
        () => {
          setPassword("");
          showSuccess(t("twoFactor.turnedOff"));
          void load();
        },
      );
    }
  };

  const submitCode = (e: Event) => {
    e.preventDefault();
    void run(
      () => enableTwoFactor(code.trim()),
      () => {
        showSuccess(t("twoFactor.turnedOn"));
        void load();
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
    const { enabled } = step.status;
    // A server from before passkeys has only the app, so on means the app.
    const authenticator = step.status.authenticator ?? enabled;
    body = (
      <div class="space-y-3">
        <p class="text-sm">
          {enabled ? t("twoFactor.isOn") : t("twoFactor.isOff")}
        </p>
        {errorLine}
        <div class="flex flex-wrap justify-end gap-2">
          {authenticator ? (
            <button
              type="button"
              class={buttonClass("secondary")}
              onClick={() => setStep({ kind: "password", purpose: "disable" })}
            >
              {t("twoFactor.turnOff")}
            </button>
          ) : (
            // Off on the server, nobody can turn it on; an account that has
            // it keeps the button above to turn it off.
            serverFeature("twoFactor") && (
              <button
                type="button"
                class={buttonClass("primary")}
                onClick={() => setStep({ kind: "password", purpose: "begin" })}
              >
                {t("twoFactor.turnOn")}
              </button>
            )
          )}
        </div>
        {step.status.authenticator !== undefined && (
          <PasskeySettings onChange={() => void load()} />
        )}
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
          <button type="submit" disabled={busy} class={buttonClass("primary")}>
            {t("twoFactor.continue")}
          </button>
        </div>
      </form>
    );
  } else {
    body = (
      <form onSubmit={submitCode} class="space-y-3">
        <p class="text-sm">{t("twoFactor.addToApp")}</p>
        <div class="flex justify-center">
          <QrCode
            value={otpauthLink(username, step.secret)}
            label={t("twoFactor.qrLabel")}
          />
        </div>
        <p class="text-sm">{t("twoFactor.orKey")}</p>
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
          <button type="submit" disabled={busy} class={buttonClass("primary")}>
            {t("twoFactor.confirm")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div class="space-y-4">
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {t("twoFactor.hint")}
      </p>
      {body}
    </div>
  );
}
