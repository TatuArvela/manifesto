import { NoteColor, NoteFont } from "@manifesto/shared";
import { Cloud, HardDrive } from "lucide-preact";
import { useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import { APP_LOGO_URL } from "../config.js";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import { currentUser, isServerMode, SERVER_ORIGIN } from "../state/auth.js";
import { showWelcome } from "../state/ui.js";
import { markWelcomed } from "../state/welcome.js";
import { Backdrop } from "./Backdrop.js";

/** How long the fade-out runs; matches the `duration-150` classes below. */
const CLOSE_MS = 150;

/** The host to name as where notes are kept. Asked only in server mode, so
 * the null branch is defensive rather than reachable. */
function serverHost(url: string | null): string {
  if (url === null) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A first-time visitor's introduction, and above all the answer to "where do
 * my notes go?". The two operating modes answer that very differently, and
 * nothing else in the interface says which one this is: an open-mode user can
 * lose everything by clearing site data without ever having been told their
 * notes lived there.
 */
export function WelcomeDialog() {
  const [closing, setClosing] = useState(false);
  const colors = noteColorMap[NoteColor.Yellow];

  const dismiss = () => {
    if (closing) return;
    markWelcomed();
    setClosing(true);
    setTimeout(() => {
      showWelcome.value = false;
    }, CLOSE_MS);
  };

  useEscapeStack(true, dismiss);
  const dialogRef = useFocusTrap<HTMLDivElement>(!closing);

  const user = currentUser.value;
  const mode = isServerMode
    ? {
        Icon: Cloud,
        title: t("welcome.server.title", { host: serverHost(SERVER_ORIGIN) }),
        body: user
          ? t("welcome.server.body", {
              user: user.displayName || user.username,
            })
          : t("welcome.server.bodyNoUser"),
      }
    : {
        Icon: HardDrive,
        title: t("welcome.local.title"),
        body: t("welcome.local.body"),
      };

  return (
    <>
      <Backdrop onDismiss={dismiss} closing={closing} class="z-40" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-dialog-title"
        aria-describedby="welcome-dialog-mode"
        class={`fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <div class="pointer-events-auto w-full max-w-md max-h-full overflow-y-auto overscroll-contain">
          <div
            class={`${colors.bg} note-surface shadow-xl px-6 pt-6 pb-4 text-neutral-900 dark:text-neutral-100`}
          >
            <img
              src={APP_LOGO_URL}
              alt=""
              class="w-8 h-8 mb-3 dark:invert"
              aria-hidden="true"
            />
            <h2
              id="welcome-dialog-title"
              class="text-2xl leading-tight mb-2"
              style={{ fontFamily: noteFontFamilies[NoteFont.PermanentMarker] }}
            >
              {t("welcome.title")}
            </h2>
            <p class="text-sm text-neutral-700 dark:text-neutral-300">
              {t("welcome.intro")}
            </p>

            <div
              id="welcome-dialog-mode"
              class="mt-4 flex gap-3 rounded-lg p-3 bg-white/60 dark:bg-black/20"
            >
              <mode.Icon
                class="w-5 h-5 shrink-0 mt-0.5 text-neutral-600 dark:text-neutral-300"
                aria-hidden="true"
              />
              <div class="min-w-0">
                <p class="text-sm font-medium break-words">{mode.title}</p>
                <p class="text-sm mt-0.5 text-neutral-600 dark:text-neutral-300">
                  {mode.body}
                </p>
              </div>
            </div>

            <div class="mt-5 flex justify-end">
              <button
                type="button"
                class="px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                onClick={dismiss}
              >
                {t("welcome.start")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
