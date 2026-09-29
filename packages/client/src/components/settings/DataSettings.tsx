import { Download, Trash2, Upload } from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import { type MessageKey, plural, t } from "../../i18n/index.js";
import {
  createNote,
  deleteAllNotes,
  downloadExport,
  importNotes,
} from "../../state/index.js";
import { restoreVersions } from "../../state/versions.js";
import { importFiles } from "../../utils/importExport.js";
import { Bookmarklet } from "../Bookmarklet.js";

/** What Import reads, as a name and a line about it, for the Data page. */
const IMPORT_FORMATS: [MessageKey, MessageKey][] = [
  ["settings.data.importHint.backup", "settings.data.importHint.backupBody"],
  [
    "settings.data.importHint.markdown",
    "settings.data.importHint.markdownBody",
  ],
  ["settings.data.importHint.keep", "settings.data.importHint.keepBody"],
  [
    "settings.data.importHint.evernote",
    "settings.data.importHint.evernoteBody",
  ],
  ["settings.data.importHint.joplin", "settings.data.importHint.joplinBody"],
  [
    "settings.data.importHint.simplenote",
    "settings.data.importHint.simplenoteBody",
  ],
  [
    "settings.data.importHint.standardNotes",
    "settings.data.importHint.standardNotesBody",
  ],
  ["settings.data.importHint.html", "settings.data.importHint.htmlBody"],
];

export function DataSettings() {
  const [dataStatus, setDataStatus] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    const ok = await downloadExport();
    setDataStatus(
      t(ok ? "settings.data.exported" : "settings.data.exportFailed"),
    );
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files || files.length === 0) return;
    const summary = await importFiles([...files], {
      createNote: (input) => createNote(input),
      importBulk: (notes) => importNotes(notes),
      importVersions: (versions) => restoreVersions(versions),
    });
    if (summary.bulkCount > 0) {
      setDataStatus(plural("settings.data.importedCount", summary.bulkCount));
    } else if (summary.singleCount > 0) {
      setDataStatus(
        summary.singleCount === 1
          ? t("settings.data.importedSingle")
          : plural("settings.data.importedCount", summary.singleCount),
      );
    } else {
      setDataStatus(t("settings.data.importFailed"));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteAll = async () => {
    // `deleteAllNotes` reports its own failure; saying "deleted" regardless
    // would contradict the toast it just raised.
    const deleted = await deleteAllNotes();
    setShowDeleteConfirm(false);
    if (deleted) setDeleteStatus(t("settings.data.deleted"));
  };

  return (
    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 rounded-lg font-medium hover:bg-neutral-200 dark:hover:bg-neutral-600 inline-flex items-center justify-center gap-1.5"
          onClick={handleImport}
        >
          <Download class="w-4 h-4" />
          {t("settings.data.import")}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 rounded-lg font-medium hover:bg-neutral-200 dark:hover:bg-neutral-600 inline-flex items-center justify-center gap-1.5"
          onClick={handleExport}
        >
          <Upload class="w-4 h-4" />
          {t("settings.data.export")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.md,.markdown,.zip,.enex,.jex,.html,.htm,image/*"
          multiple
          class="hidden"
          onChange={handleFileChange}
        />
      </div>
      {dataStatus && (
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {dataStatus}
        </p>
      )}
      <div class="text-sm text-neutral-500 dark:text-neutral-400">
        <p>{t("settings.data.importHint")}</p>
        <ul class="mt-2 space-y-1.5 list-disc pl-5">
          {IMPORT_FORMATS.map(([label, body]) => (
            <li key={label}>
              <span class="font-medium text-neutral-700 dark:text-neutral-200">
                {t(label)}
              </span>
              {": "}
              {t(body)}
            </li>
          ))}
        </ul>
      </div>
      <div class="pt-3 border-t border-neutral-200 dark:border-neutral-700">
        {showDeleteConfirm ? (
          <div class="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600">
            <p class="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
              {t("settings.data.deleteConfirm")}
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class="flex-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
                onClick={handleDeleteAll}
              >
                {t("settings.data.deleteYes")}
              </button>
              <button
                type="button"
                class="flex-1 px-3 py-1.5 text-sm bg-neutral-200 dark:bg-neutral-600 rounded-lg font-medium hover:bg-neutral-300 dark:hover:bg-neutral-500"
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t("settings.data.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            class="w-full px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg font-medium hover:bg-red-200 dark:hover:bg-red-900/50 inline-flex items-center justify-center gap-1.5"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 class="w-4 h-4" />
            {t("settings.data.deleteAll")}
          </button>
        )}
        {deleteStatus && (
          <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            {deleteStatus}
          </p>
        )}
      </div>
      <Bookmarklet />
    </div>
  );
}
