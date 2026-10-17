import { useEffect, useState } from "preact/hooks";
import { plural, t } from "#/i18n/index.js";
import { createNote, importNotes } from "#/state/notesStore.js";
import { showError, showSuccess } from "#/state/ui.js";
import { restoreVersions } from "#/state/versions.js";
import { importFiles, isImportableFile } from "#/utils/importExport.js";

/**
 * Imports the files dropped anywhere on the window, as Settings' import
 * does, and says whether files are being dragged over it now.
 */
export function useFileDropImport(): boolean {
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      setDragActive(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragActive(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDragActive(false);
      const files = [...(e.dataTransfer?.files ?? [])].filter(isImportableFile);
      if (files.length === 0) {
        showError(t("settings.data.importFailed"));
        return;
      }
      const summary = await importFiles(files, {
        createNote: (input) => createNote(input),
        importBulk: (n) => importNotes(n),
        importVersions: (versions) => restoreVersions(versions),
      });
      if (summary.bulkCount > 0) {
        showSuccess(plural("settings.data.importedCount", summary.bulkCount));
      } else if (summary.singleCount === 1) {
        showSuccess(t("settings.data.importedSingle"));
      } else if (summary.singleCount > 1) {
        showSuccess(plural("settings.data.importedCount", summary.singleCount));
      }
      if (
        summary.failedCount > 0 &&
        summary.bulkCount + summary.singleCount === 0
      ) {
        showError(t("settings.data.importFailed"));
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return dragActive;
}
