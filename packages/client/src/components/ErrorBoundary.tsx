import { LOCAL_IMAGE_REF_PREFIX } from "@manifesto/shared";
import { Component, type ComponentChildren } from "preact";
import { APP_FILE_SLUG, APP_NAME } from "#/config.ts";
import { t } from "#/i18n/index.ts";
import { revealApp } from "#/splash.ts";
import { getLocalImage } from "#/storage/localImages.ts";
import { blobToDataUrl } from "#/utils/dataUrl.ts";
import { buttonClass } from "./buttonClasses.ts";

const NOTES_KEY = "manifesto:notes";

interface Props {
  children: ComponentChildren;
}

interface State {
  error: Error | null;
}

/**
 * The stored notes, with each `local:` image reference, also those of previews,
 * replaced by its bytes from IndexedDB, because a backup of only references has
 * no pictures. This is best effort. If something cannot be read (the JSON, the
 * database, one image), the code keeps what is on disk, because a backup
 * without a picture is better than no backup.
 */
async function withImagesInlined(raw: string): Promise<string> {
  let notes: unknown;
  try {
    notes = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (!Array.isArray(notes)) return raw;
  for (const note of notes) {
    if (!note || typeof note !== "object") continue;
    if (Array.isArray(note.images)) {
      note.images = await Promise.all(note.images.map(inlineLocal));
    }
    if (Array.isArray(note.linkPreviews)) {
      for (const preview of note.linkPreviews) {
        if (!preview || typeof preview !== "object") continue;
        for (const field of ["image", "favicon"] as const) {
          if (field in preview)
            preview[field] = await inlineLocal(preview[field]);
        }
      }
    }
  }
  return JSON.stringify(notes);
}

/** A `local:` reference as a `data:` URL, or any other value as it is. */
async function inlineLocal(image: unknown): Promise<unknown> {
  if (typeof image !== "string" || !image.startsWith(LOCAL_IMAGE_REF_PREFIX))
    return image;
  try {
    return (await blobToDataUrl(await getLocalImage(image))) ?? image;
  } catch {
    return image;
  }
}

/**
 * Catches errors at render time. Thus, one bad note cannot make the app show
 * only a white screen.
 *
 * The failure for which this exists is persistent, not temporary. A note with
 * an unknown `color` or `font` throws inside `NoteCard`. It is stored in
 * `localStorage`. Thus, it throws again on each later load. Thus, the fallback
 * must give a way *out*. A reload alone would keep the user in the same crash
 * forever. The backup button reads `localStorage` directly, not through the
 * storage layer, because that layer can be the broken part. Only the open-mode
 * images come from IndexedDB, and only as best effort.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static override getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    console.error("%s crashed during render", APP_NAME, error);
    // The fallback, with its backup button, is the screen now.
    revealApp();
  }

  private downloadBackup = async (): Promise<void> => {
    let raw = "[]";
    try {
      raw = localStorage.getItem(NOTES_KEY) ?? "[]";
    } catch {
      // Storage cannot be read (private mode, blocked cookies). Continue, and
      // give the user an empty file. Do not fail the click silently.
    }
    raw = await withImagesInlined(raw);
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
              class={buttonClass("primary", "sm")}
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
