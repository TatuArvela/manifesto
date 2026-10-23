import type { DeviceSignInRequestResponse } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import { Backdrop } from "#/components/Backdrop.tsx";
import { buttonClass } from "#/components/buttonClasses.ts";
import {
  ConfirmationError,
  ConfirmPasswordField,
} from "#/components/ConfirmWithPassword.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { t } from "#/i18n/index.ts";
import {
  approveDeviceSignIn,
  denyDeviceSignIn,
  inspectDeviceSignIn,
  type ScannedRequest,
  scannedDeviceRequest,
} from "#/state/account/deviceSignIn.ts";
import type { ConfirmationRefusal } from "#/state/account/passwordConfirmation.ts";
import { locale } from "#/state/prefs.ts";
import { showSuccess } from "#/state/ui.ts";
import { inputClass } from "./loginFormClasses.ts";

/** The duration of the fade-out, as the other dialogs. */
const CLOSE_MS = 150;

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat(locale.value, { timeStyle: "short" }).format(
    new Date(iso),
  );

/**
 * The approval of a new device, after the camera of this device opened its QR
 * code. It names the browser that asked, and when. The person types the
 * matching code from the other screen, and confirms with the password. Thus,
 * the approval goes to the screen in front of them, and not to a code that a
 * different person sent them.
 */
export function DeviceSignInApproval({ request }: { request: ScannedRequest }) {
  const [info, setInfo] = useState<
    DeviceSignInRequestResponse | "loading" | "gone" | "failed"
  >("loading");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [refusal, setRefusal] = useState<ConfirmationRefusal | null>(null);
  const [error, setError] = useState<"wrongCode" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let live = true;
    void inspectDeviceSignIn(request.id).then((found) => {
      if (live) setInfo(found);
    });
    return () => {
      live = false;
    };
  }, [request.id]);

  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      scannedDeviceRequest.value = null;
    }, CLOSE_MS);
  };

  useEscapeStack(true, dismiss);
  const dialogRef = useFocusTrap<HTMLDivElement>(!closing);

  const deny = () => {
    void denyDeviceSignIn(request.id);
    dismiss();
  };

  const submit = async (event: Event) => {
    event.preventDefault();
    if (busy) return;
    setRefusal(null);
    setError(null);
    setBusy(true);
    const result = await approveDeviceSignIn(request, code, password);
    setBusy(false);
    if (result.kind === "ok") {
      showSuccess(t("deviceSignIn.approved"));
      dismiss();
    } else if (result.kind === "gone") {
      setInfo("gone");
    } else if (result.kind === "wrongCode" || result.kind === "failed") {
      setError(result.kind);
    } else {
      setRefusal(result.kind);
    }
  };

  const ready = typeof info === "object";
  return (
    <>
      <Backdrop onDismiss={dismiss} closing={closing} class="layer-backdrop" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-sign-in-title"
        class={`fixed inset-0 layer-sheet flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <form
          onSubmit={submit}
          class="pointer-events-auto w-full max-w-sm max-h-full overflow-y-auto overscroll-contain rounded-xl bg-white dark:bg-neutral-800 shadow-xl p-5 space-y-4 text-neutral-900 dark:text-neutral-100"
        >
          <h2 id="device-sign-in-title" class="text-lg font-semibold">
            {t("deviceSignIn.title")}
          </h2>
          {info === "loading" && (
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              {t("deviceSignIn.loading")}
            </p>
          )}
          {(info === "gone" || info === "failed") && (
            <p
              class="text-sm text-neutral-600 dark:text-neutral-300"
              role="alert"
            >
              {t(info === "gone" ? "deviceSignIn.gone" : "deviceSignIn.failed")}
            </p>
          )}
          {ready && (
            <>
              <p class="text-sm text-neutral-600 dark:text-neutral-300">
                {t("deviceSignIn.asked", { time: formatTime(info.createdAt) })}
              </p>
              {info.userAgent && (
                <p class="text-sm font-mono break-words rounded-lg bg-neutral-100 dark:bg-neutral-900 p-3">
                  {info.userAgent}
                </p>
              )}
              <p class="text-sm font-medium text-amber-800 dark:text-amber-300">
                {t("deviceSignIn.warning")}
              </p>
              <label class="block">
                <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
                  {t("deviceSignIn.code")}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  // biome-ignore lint/a11y/noAutofocus: the one thing to do in this dialog
                  autoFocus
                  maxLength={7}
                  value={code}
                  onInput={(e) =>
                    setCode((e.currentTarget as HTMLInputElement).value)
                  }
                  class={`${inputClass} font-mono tracking-widest`}
                />
              </label>
              <ConfirmPasswordField value={password} onInput={setPassword} />
              {refusal && <ConfirmationError refusal={refusal} />}
              {error && (
                <p class="text-sm text-red-600 dark:text-red-400" role="alert">
                  {t(
                    error === "wrongCode"
                      ? "deviceSignIn.wrongCode"
                      : "deviceSignIn.failed",
                  )}
                </p>
              )}
            </>
          )}
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class={buttonClass("secondary")}
              onClick={ready ? deny : dismiss}
            >
              {t(ready ? "deviceSignIn.deny" : "confirm.cancel")}
            </button>
            {ready && (
              <button
                type="submit"
                disabled={busy || code.replace(/\D/g, "").length !== 6}
                class={buttonClass("primary")}
              >
                {t("deviceSignIn.approve")}
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
