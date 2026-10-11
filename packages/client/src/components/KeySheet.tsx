import { Download, Printer } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { APP_FILE_SLUG } from "../config.js";
import { t } from "../i18n/index.js";
import type { KeySheet } from "../state/accountKeys.js";
import { downloadFile } from "../utils/noteDownload.js";
import { submitClass } from "./loginFormClasses.js";

const secondaryClass =
  "inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer";

/** While a sheet is on screen, printing the page prints the sheet alone
 * (`styles.css`). */
const PRINTING_CLASS = "key-sheet-open";

/** The sheet as a text file: what it shows, and what each key is for. */
function sheetText(sheet: KeySheet): string {
  const lines = [
    t("keys.sheet.title"),
    "",
    `${t("keys.sheet.server")}: ${sheet.server}`,
    `${t("keys.sheet.username")}: ${sheet.username}`,
  ];
  if (sheet.secretKey !== null) {
    lines.push(
      "",
      `${t("keys.secretKey")}: ${sheet.secretKey}`,
      t("keys.sheet.secretKeyHint"),
    );
  }
  if (sheet.recoveryKey !== null) {
    lines.push(
      "",
      `${t("keys.recoveryKey")}: ${sheet.recoveryKey}`,
      t("keys.sheet.recoveryKeyHint"),
    );
  }
  lines.push("", t("keys.sheet.keepSafe"), "");
  return lines.join("\n");
}

function Entry({
  label,
  value,
  hint,
  mono,
}: {
  label: string;
  value: string;
  hint?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt class="text-xs font-medium text-neutral-500 dark:text-neutral-400">
        {label}
      </dt>
      <dd
        class={`break-all select-all ${mono ? "font-mono text-sm tracking-wide" : "text-sm"}`}
      >
        {value}
      </dd>
      {hint && (
        <dd class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
          {hint}
        </dd>
      )}
    </div>
  );
}

/**
 * The sheet with an account's keys, to save or print: the server's address
 * and the username it belongs to, and whichever of the secret key and the
 * recovery key it carries. Shown when the keys are made and never again, so
 * it comes with both ways of keeping it.
 */
export function KeySheetView({ sheet }: { sheet: KeySheet }) {
  useEffect(() => {
    document.body.classList.add(PRINTING_CLASS);
    return () => document.body.classList.remove(PRINTING_CLASS);
  }, []);

  return (
    <div class="space-y-3">
      <div class="key-sheet rounded-lg border border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-900 p-4">
        <p class="mb-3 text-sm font-semibold">{t("keys.sheet.title")}</p>
        <dl class="space-y-3">
          <Entry label={t("keys.sheet.server")} value={sheet.server} />
          <Entry label={t("keys.sheet.username")} value={sheet.username} />
          {sheet.secretKey !== null && (
            <Entry
              label={t("keys.secretKey")}
              value={sheet.secretKey}
              hint={t("keys.sheet.secretKeyHint")}
              mono
            />
          )}
          {sheet.recoveryKey !== null && (
            <Entry
              label={t("keys.recoveryKey")}
              value={sheet.recoveryKey}
              hint={t("keys.sheet.recoveryKeyHint")}
              mono
            />
          )}
        </dl>
        <p class="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
          {t("keys.sheet.keepSafe")}
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class={secondaryClass}
          onClick={() =>
            downloadFile(
              sheetText(sheet),
              `${APP_FILE_SLUG}-keys-${sheet.username || "account"}.txt`,
              "text/plain;charset=utf-8",
            )
          }
        >
          <Download class="w-4 h-4" />
          {t("keys.sheet.download")}
        </button>
        <button
          type="button"
          class={secondaryClass}
          onClick={() => window.print()}
        >
          <Printer class="w-4 h-4" />
          {t("keys.sheet.print")}
        </button>
      </div>
    </div>
  );
}

/**
 * A sheet that has to be kept before anything goes on: the keys on it are
 * shown this once, so the button waits for the user to say they have it.
 * `children` are whatever else the step asks for, between the sheet and the
 * promise.
 */
export function KeepSheetStep({
  sheet,
  children,
  submitLabel,
  error,
  busy,
  onSubmit,
}: {
  sheet: KeySheet;
  children?: ComponentChildren;
  submitLabel: string;
  error: ComponentChildren;
  busy: boolean;
  onSubmit: () => void;
}) {
  const [kept, setKept] = useState(false);
  return (
    <form
      class="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (kept && !busy) onSubmit();
      }}
    >
      <KeySheetView sheet={sheet} />
      {children}
      <label class="flex items-start gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          class="mt-0.5"
          checked={kept}
          onChange={(e) =>
            setKept((e.currentTarget as HTMLInputElement).checked)
          }
        />
        <span>{t("keys.sheet.kept")}</span>
      </label>
      {error}
      <button type="submit" disabled={!kept || busy} class={submitClass}>
        {busy ? t("login.submitting") : submitLabel}
      </button>
    </form>
  );
}
