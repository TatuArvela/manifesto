import { effect } from "@preact/signals";
import { Upload } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { plural, t } from "../i18n/index.js";
import { decodeShareFromHash, type SharedNotePayload } from "../sharing.js";
import {
  activeView,
  createNote,
  editingNoteId,
  importNotes,
  loadNotes,
  notes,
  showError,
  showSuccess,
  updateNote,
  viewMode,
} from "../state/index.js";
import { initReminderScheduler } from "../state/reminderScheduler.js";
import { importFiles, isImportableFile } from "../utils/importExport.js";
import { Header } from "./Header.js";
import { NoteGrid } from "./NoteGrid.js";
import { NoteInput } from "./NoteInput.js";
import { ReminderBanner } from "./ReminderBanner.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { SharedNoteDialog } from "./SharedNoteDialog.js";
import { Sidebar } from "./Sidebar.js";
import { TagsView } from "./TagsView.js";
import { Toasts } from "./Toast.js";

export function App() {
  const [sharedNote, setSharedNote] = useState<SharedNotePayload | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    loadNotes();
    initReminderScheduler({
      notes: () => notes.value,
      subscribe: (listener) => effect(() => listener(notes.value)),
      updateNote: (id, changes) => {
        void updateNote(id, changes);
      },
    });
    const openHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ noteId: string }>).detail;
      if (detail?.noteId) editingNoteId.value = detail.noteId;
    };
    window.addEventListener("reminder:open-note", openHandler);
    const payload = decodeShareFromHash(window.location.hash);
    if (payload) setSharedNote(payload);
    return () => {
      window.removeEventListener("reminder:open-note", openHandler);
    };
  }, []);

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

  const isTagsView = activeView.value === "tags";
  const isActive = activeView.value === "active";
  const isList = viewMode.value === "list";

  return (
    <div class="flex flex-col h-screen overflow-hidden">
      <Header />
      <div class="flex flex-1 overflow-hidden relative z-0">
        <Sidebar />
        <main
          class={`flex-1 overflow-y-auto px-4 md:px-6 pb-4 md:pb-6 ${isActive ? "-mt-4" : "pt-2"}`}
        >
          {isTagsView ? (
            isList ? (
              <div class="max-w-xl mx-auto">
                <TagsView />
                <NoteGrid />
              </div>
            ) : (
              <>
                <TagsView />
                <NoteGrid />
              </>
            )
          ) : isList ? (
            <div class="max-w-xl mx-auto">
              <NoteInput />
              <NoteGrid />
            </div>
          ) : (
            <>
              <NoteInput />
              <NoteGrid />
            </>
          )}
        </main>
      </div>
      <SettingsDialog />
      <ReminderBanner />
      <Toasts />
      {sharedNote && (
        <SharedNoteDialog
          payload={sharedNote}
          onDone={() => setSharedNote(null)}
        />
      )}
      {dragActive && (
        <div class="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-blue-500/10 backdrop-blur-[2px]">
          <div class="m-6 px-8 py-6 rounded-2xl border-2 border-dashed border-blue-500 bg-white/90 dark:bg-gray-800/90 shadow-xl flex flex-col items-center gap-2 text-center">
            <Upload class="w-8 h-8 text-blue-600 dark:text-blue-400" />
            <p class="text-lg font-semibold">{t("dropZone.title")}</p>
            <p class="text-sm text-gray-600 dark:text-gray-300">
              {t("dropZone.hint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
