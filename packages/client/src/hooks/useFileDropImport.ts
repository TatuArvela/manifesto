import { useEffect, useState } from "preact/hooks";
import { plural, t } from "#/i18n/index.ts";
import { imagesForNote, startNoteWith } from "#/state/incomingShare.ts";
import { createNote, importNotes } from "#/state/notesStore.ts";
import { showError, showSuccess } from "#/state/ui.ts";
import { restoreVersions } from "#/state/versions.ts";
import { importFiles, isImportableFile } from "#/utils/importExport.ts";
import { hasOpenLayer } from "./useShortcut.ts";

/** What is being dragged over the window, for the drop zone to say. */
export type FileDrag = "none" | "import" | "images";

/**
 * Whether every file in a drag or drop is a picture. During a drag only the
 * kinds and types are known, and a browser that hides even those (Safari)
 * reads as not all pictures, so the zone says "import" until the drop.
 */
function allImages(items: readonly { kind: string; type: string }[]): boolean {
  return (
    items.length > 0 &&
    items.every(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    )
  );
}

/**
 * Takes the files dropped anywhere on the window. Pictures alone, dropped
 * with no note open, start a new note holding them; anything else is
 * imported, as Settings' import does. Says what is being dragged over the
 * window now.
 */
export function useFileDropImport(): FileDrag {
  const [drag, setDrag] = useState<FileDrag>("none");

  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      setDrag(
        allImages([...(e.dataTransfer?.items ?? [])]) && !hasOpenLayer()
          ? "images"
          : "import",
      );
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
      if (dragDepth === 0) setDrag("none");
    };
    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDrag("none");
      const dropped = [...(e.dataTransfer?.files ?? [])];
      if (
        !hasOpenLayer() &&
        allImages(dropped.map((file) => ({ kind: "file", type: file.type })))
      ) {
        const images = await imagesForNote(
          dropped.map((file) => ({ blob: file, name: file.name })),
        );
        startNoteWith("", images);
        return;
      }
      const files = dropped.filter(isImportableFile);
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

  return drag;
}
