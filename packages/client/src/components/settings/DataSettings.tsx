import { Download, Trash2, Upload } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useRef, useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import { type MessageKey, plural, t } from "#/i18n/index.ts";
import { downloadExport } from "#/state/exportNotes.ts";
import { createNote, deleteAllNotes, importNotes } from "#/state/notesStore.ts";
import { restoreVersions } from "#/state/versions.ts";
import { importFiles } from "#/utils/importExport.ts";
import { SettingsGroup } from "./SettingsControls.tsx";

/** What Import reads: an app or format, and which file to bring from it. */
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

/**
 * One action of the Data page: what it does, in a sentence, and the button that
 * does it. For a settings search, the text of the button is the name of the
 * row.
 */
function ActionRow({
  body,
  children,
}: {
  body: string;
  children: ComponentChildren;
}) {
  return (
    <div
      class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-3 py-2"
      data-setting-row
    >
      <p class="flex-1 text-sm text-neutral-600 dark:text-neutral-300">
        {body}
      </p>
      <div class="shrink-0">{children}</div>
    </div>
  );
}

/**
 * The apps and formats that Import reads, as chips to select from, with what to
 * bring from the selected one under them. The first, a backup of this app, is
 * selected at the start.
 */
function ImportFormats() {
  const [chosen, setChosen] = useState(0);
  const [label, body] = IMPORT_FORMATS[chosen] ?? IMPORT_FORMATS[0] ?? [];
  return (
    <div class="px-3 pt-1 pb-2 space-y-3">
      <div class="flex flex-wrap gap-1.5">
        {IMPORT_FORMATS.map(([name], i) => (
          <button
            key={name}
            type="button"
            class={`px-2.5 py-1 text-xs rounded-full cursor-pointer transition-colors ring-1 ring-inset ${
              i === chosen
                ? "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-blue-300 dark:ring-blue-700 font-medium"
                : "text-neutral-700 dark:text-neutral-200 ring-neutral-200 dark:ring-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700"
            }`}
            aria-pressed={i === chosen}
            onClick={() => setChosen(i)}
          >
            {t(name)}
          </button>
        ))}
      </div>
      {label && body && (
        <p
          aria-live="polite"
          class="px-3 py-2 rounded-lg text-sm bg-neutral-100/70 dark:bg-white/[0.05] text-neutral-600 dark:text-neutral-300"
        >
          <span class="font-medium text-neutral-800 dark:text-neutral-100">
            {t(label)}
          </span>
          {": "}
          {t(body)}
        </p>
      )}
    </div>
  );
}

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
      setDataStatus(
        t(
          summary.newerCount > 0
            ? "settings.data.importNewer"
            : "settings.data.importFailed",
        ),
      );
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteAll = async () => {
    // `deleteAllNotes` reports its own failure. If the code said "deleted"
    // anyway, it would contradict the toast that it just showed.
    const deleted = await deleteAllNotes();
    setShowDeleteConfirm(false);
    if (deleted) setDeleteStatus(t("settings.data.deleted"));
  };

  return (
    <div class="space-y-6">
      <SettingsGroup title={t("settings.data.group.import")}>
        {/* One row to the group's dividers: the chips belong to the action. */}
        <div>
          <ActionRow body={t("settings.data.importBody")}>
            <button
              type="button"
              class={buttonClass("secondary", "sm")}
              onClick={handleImport}
            >
              <Download class="w-4 h-4" />
              {t("settings.data.import")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.md,.markdown,.zip,.enex,.jex,.html,.htm,image/*"
              multiple
              class="hidden"
              onChange={handleFileChange}
            />
          </ActionRow>
          <ImportFormats />
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings.data.group.export")}>
        <ActionRow body={t("settings.data.exportBody")}>
          <button
            type="button"
            class={buttonClass("secondary", "sm")}
            onClick={handleExport}
          >
            <Upload class="w-4 h-4" />
            {t("settings.data.export")}
          </button>
        </ActionRow>
      </SettingsGroup>

      {dataStatus && (
        <p
          role="status"
          class="px-3 text-sm text-neutral-600 dark:text-neutral-300"
        >
          {dataStatus}
        </p>
      )}

      <SettingsGroup title={t("settings.data.group.delete")}>
        <ActionRow body={t("settings.data.deleteBody")}>
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium cursor-pointer transition-colors bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50"
            aria-expanded={showDeleteConfirm}
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 class="w-4 h-4" />
            {t("settings.data.deleteAll")}
          </button>
        </ActionRow>
        {showDeleteConfirm && (
          <div class="mx-3 my-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600">
            <p class="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
              {t("settings.data.deleteConfirm")}
            </p>
            <div class="flex gap-2">
              <button
                type="button"
                class={`${buttonClass("danger", "sm")} flex-1`}
                onClick={handleDeleteAll}
              >
                {t("settings.data.deleteYes")}
              </button>
              <button
                type="button"
                class={`${buttonClass("secondary", "sm")} flex-1`}
                onClick={() => setShowDeleteConfirm(false)}
              >
                {t("settings.data.cancel")}
              </button>
            </div>
          </div>
        )}
        {deleteStatus && (
          <p
            role="status"
            class="px-3 py-2 text-sm text-neutral-600 dark:text-neutral-300"
          >
            {deleteStatus}
          </p>
        )}
      </SettingsGroup>
    </div>
  );
}
