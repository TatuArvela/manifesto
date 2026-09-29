import type { PendingUpload } from "../hooks/useImageUploads.js";
import { t } from "../i18n/index.js";

/** Images being stored: the file as it was picked, with progress, or marked
 * as failed with a retry. */
export function PendingUploads({
  uploads,
  onRetry,
  onRemove,
}: {
  uploads: PendingUpload[];
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div class="flex flex-col">
      {uploads.map((upload) => (
        <div key={upload.key} class="relative bg-black/5 dark:bg-white/5">
          <img
            src={upload.preview}
            alt=""
            class={`w-full h-auto max-h-96 object-cover block ${upload.failed ? "opacity-40" : "opacity-70"}`}
          />
          {upload.failed ? (
            <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center">
              <p class="text-sm font-medium text-red-700 dark:text-red-300 bg-white/80 dark:bg-black/60 rounded px-2 py-1">
                {t("editor.uploadFailed", { name: upload.file.name })}
              </p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="px-3 py-1 text-sm rounded-full bg-white/90 dark:bg-neutral-800/90 hover:bg-white dark:hover:bg-neutral-700 cursor-pointer"
                  onClick={() => onRetry(upload.key)}
                >
                  {t("editor.retryUpload")}
                </button>
                <button
                  type="button"
                  class="px-3 py-1 text-sm rounded-full bg-white/90 dark:bg-neutral-800/90 hover:bg-white dark:hover:bg-neutral-700 cursor-pointer"
                  onClick={() => onRemove(upload.key)}
                >
                  {t("editor.removeUpload")}
                </button>
              </div>
            </div>
          ) : (
            <div
              class="absolute inset-x-0 bottom-0 h-1 bg-black/10"
              role="progressbar"
              aria-label={t("editor.uploading", { name: upload.file.name })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(upload.progress * 100)}
            >
              <div
                class="h-full bg-blue-500 transition-[width] duration-150"
                style={{ width: `${Math.round(upload.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
