import { NoteColor, NoteFont } from "@manifesto/shared";
import { Cloud, HardDrive } from "lucide-preact";
import { useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "#/colors.ts";
import { APP_LOGO } from "#/config.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { t } from "#/i18n/index.ts";
import {
  currentUser,
  isServerMode,
  SERVER_ORIGIN,
} from "#/state/account/auth.ts";
import { showWelcome } from "#/state/ui.ts";
import { markWelcomed } from "#/state/welcome.ts";
import { Backdrop } from "./Backdrop.tsx";
import { BrandLogo } from "./BrandLogo.tsx";
import { buttonClass } from "./buttonClasses.ts";

/**
 * The duration of the fade-out. It agrees with the `duration-150` classes
 * below.
 */
const CLOSE_MS = 150;

/**
 * The host to name as the place where notes are kept. The code asks only in
 * server mode. Thus, the null branch is a precaution, and the code cannot reach
 * it.
 */
function serverHost(url: string | null): string {
  if (url === null) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Where this deployment keeps notes. The two operating modes answer this very
 * differently: on this device, or on a named server. The welcome dialog starts
 * with it, and the About page of the settings repeats it.
 */
export function StorageMode({
  id,
  class: extra,
}: {
  id?: string;
  /** Its spacing and background, which depend on the surface below it. */
  class: string;
}) {
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
    <div id={id} class={`flex gap-3 rounded-lg p-3 ${extra}`}>
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
  );
}

/**
 * The introduction for a first-time visitor, and most important, the answer to
 * "where do my notes go?". The two operating modes answer that very
 * differently, and no other part of the interface tells which mode this is. An
 * open-mode user can lose all data when they clear the site data, if nobody
 * told them that their notes were there.
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

  return (
    <>
      <Backdrop onDismiss={dismiss} closing={closing} class="layer-backdrop" />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-dialog-title"
        aria-describedby="welcome-dialog-mode"
        class={`fixed inset-0 layer-sheet flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <div class="pointer-events-auto w-full max-w-md max-h-full overflow-y-auto overscroll-contain">
          <div
            class={`${colors.bg} note-surface shadow-xl px-6 pt-6 pb-4 text-neutral-900 dark:text-neutral-100`}
          >
            <BrandLogo logo={APP_LOGO} class="w-8 h-8 mb-3" />
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

            <StorageMode
              id="welcome-dialog-mode"
              class="mt-4 bg-white/60 dark:bg-black/20"
            />

            <div class="mt-5 flex justify-end">
              <button
                type="button"
                class={buttonClass("primary")}
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
