import { useEffect, useState } from "preact/hooks";
import { QrCode } from "#/components/QrCode.tsx";
import { t } from "#/i18n/index.ts";
import {
  checkDeviceSignIn,
  type DeviceRequest,
  startDeviceSignIn,
} from "#/state/account/deviceSignIn.ts";
import { quietClass, submitClass } from "./loginFormClasses.ts";

/** How often the new device asks if its request was approved. */
const POLL_MS = 3000;

/** Minutes and seconds until `at`, as `2:05`. */
function remaining(at: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((at - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * The sign-in by a device that is already signed in. This screen shows a QR
 * code and its matching code, and asks the server each few seconds until the
 * other device approves. A success signs in, and this screen goes. An expired
 * code makes a new one only on a press, because each one is a row on the
 * server.
 */
export function DeviceSignInPanel({ onBack }: { onBack: () => void }) {
  const [request, setRequest] = useState<DeviceRequest | null>(null);
  const [state, setState] = useState<"starting" | "showing" | "expired">(
    "starting",
  );
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState("starting");
    setFailed(false);
    void startDeviceSignIn().then((started) => {
      if (!live) return;
      if (!started) {
        setFailed(true);
        setState("expired");
        return;
      }
      setRequest(started);
      setNow(Date.now());
      setState("showing");
    });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (state !== "showing" || !request) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = async () => {
      if (!live) return;
      if (Date.now() >= request.expiresAt) {
        setState("expired");
        return;
      }
      const result = await checkDeviceSignIn(request);
      if (!live) return;
      if (result === "gone") {
        setState("expired");
        return;
      }
      // `signedIn` replaces this screen. A failed request tries again.
      if (result !== "signedIn") timer = setTimeout(poll, POLL_MS);
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      live = false;
      clearInterval(tick);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [state, request]);

  return (
    <div class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-neutral-900 dark:text-neutral-50">
          {t("login.device.title")}
        </h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
          {t("login.device.hint")}
        </p>
      </div>
      {state === "showing" && request && (
        <>
          <div class="flex justify-center">
            <QrCode value={request.address} label={t("login.device.qrLabel")} />
          </div>
          <div class="text-center">
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              {t("login.device.matchHint")}
            </p>
            <p
              class="mt-1 font-mono text-2xl tracking-widest text-neutral-900 dark:text-neutral-50"
              data-testid="device-match-code"
            >
              {request.matchCode}
            </p>
          </div>
          <p class="text-xs text-center text-neutral-500 dark:text-neutral-400">
            {t("login.device.expiresIn", {
              time: remaining(request.expiresAt, now),
            })}
          </p>
        </>
      )}
      {state === "starting" && (
        <p
          class="text-sm text-center text-neutral-600 dark:text-neutral-300"
          role="status"
        >
          {t("login.device.starting")}
        </p>
      )}
      {state === "expired" && (
        <>
          <p
            class={`text-sm text-center ${failed ? "text-red-600 dark:text-red-400" : "text-neutral-600 dark:text-neutral-300"}`}
            role={failed ? "alert" : "status"}
          >
            {t(failed ? "login.serverUnavailable" : "login.device.expired")}
          </p>
          <button
            type="button"
            class={submitClass}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {t("login.device.again")}
          </button>
        </>
      )}
      <button type="button" class={quietClass} onClick={onBack}>
        {t("login.back")}
      </button>
    </div>
  );
}
