import { Download, Printer } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import { APP_FILE_SLUG } from "#/config.ts";
import { t } from "#/i18n/index.ts";
import type { KeySheet } from "#/state/account/accountKeys.ts";
import { downloadFile } from "#/utils/noteDownload.ts";
import { submitClass } from "./loginFormClasses.ts";

/**
 * While a sheet is on the screen, a print of the page prints only the sheet
 * (`styles.css`).
 */
const PRINTING_CLASS = "key-sheet-open";

/** The sheet as a text file: what it shows, and the purpose of each key. */
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
 * The sheet with the keys of an account, to save or print: the address of the
 * server and the username to which it belongs, and the secret key or the
 * recovery key that it contains. It shows when the keys are made, and never
 * again. Thus, it comes with both ways to keep it.
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
          class={buttonClass("secondary")}
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
          class={buttonClass("secondary")}
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
 * A sheet that you must keep before anything continues. The keys on it show
 * this one time. Thus, the button waits until the user says that they have it.
 * `children` are the other items that the step asks for, between the sheet and
 * the promise.
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
