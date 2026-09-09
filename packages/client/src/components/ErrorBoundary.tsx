import { Component, type ComponentChildren } from "preact";
import { APP_FILE_SLUG, APP_NAME } from "../config.js";
import { t } from "../i18n/index.js";

const NOTES_KEY = "manifesto:notes";

interface Props {
  children: ComponentChildren;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time errors so a single bad note can't white-screen the app.
 *
 * The failure this exists for is persistent, not transient: a note carrying an
 * unknown `color` or `font` throws inside `NoteCard`, and because it is stored
 * in `localStorage` it throws again on every subsequent load. So the fallback
 * has to offer a way *out* — reloading alone would trap the user in the same
 * crash forever. The backup button reads `localStorage` directly rather than
 * going through the storage layer, because that layer may be what's broken.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`${APP_NAME} crashed during render`, error);
  }

  private downloadBackup = (): void => {
    let raw = "[]";
    try {
      raw = localStorage.getItem(NOTES_KEY) ?? "[]";
    } catch {
      // Storage unreadable (private mode, blocked cookies) — fall through and
      // hand the user an empty file rather than failing the click silently.
    }
    const url = URL.createObjectURL(
      new Blob([raw], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${APP_FILE_SLUG}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div class="min-h-screen flex items-center justify-center p-4 bg-neutral-50 dark:bg-neutral-900">
        <div class="max-w-md w-full bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 p-6">
          <h1 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {t("error.title")}
          </h1>
          <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            {t("error.body")}
          </p>

          <div class="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
              onClick={() => window.location.reload()}
            >
              {t("error.reload")}
            </button>
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-md border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
              onClick={this.downloadBackup}
            >
              {t("error.backup")}
            </button>
          </div>

          <details class="mt-5">
            <summary class="text-xs text-neutral-500 dark:text-neutral-400 cursor-pointer">
              {t("error.details")}
            </summary>
            <pre class="mt-2 p-2 rounded bg-neutral-100 dark:bg-neutral-900 text-xs text-neutral-700 dark:text-neutral-300 overflow-x-auto whitespace-pre-wrap">
              {error.stack ?? error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
