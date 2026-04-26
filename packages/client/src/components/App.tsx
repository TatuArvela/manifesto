import { effect } from "@preact/signals";
import { Upload } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { plural, t } from "../i18n/index.js";
import { startAppSocket } from "../realtime/appSocket.js";
import { decodeShareFromHash, type SharedNotePayload } from "../sharing.js";
import { authToken, consumeOidcRedirect, isServerMode } from "../state/auth.js";
import { initAutoNotes } from "../state/autoNotes.js";
import {
  activeView,
  createNote,
  editingNoteId,
  importNotes,
  initRouter,
  loadNotes,
  notes,
  showError,
  showSuccess,
  updateNote,
  viewMode,
} from "../state/index.js";
import { initReminderScheduler } from "../state/reminderScheduler.js";
import { importFiles, isImportableFile } from "../utils/importExport.js";
import { AutoNotesView } from "./AutoNotesView.js";
import { ConnectionStatus } from "./ConnectionStatus.js";
import { Header } from "./Header.js";
import { LoginScreen } from "./LoginScreen.js";
import { NoteGrid } from "./NoteGrid.js";
import { NoteInput } from "./NoteInput.js";
import { ReminderBanner } from "./ReminderBanner.js";
import { SearchView } from "./SearchView.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { SharedNoteDialog } from "./SharedNoteDialog.js";
import { MobileNav, Sidebar } from "./Sidebar.js";
import { TagsView } from "./TagsView.js";
import { Toasts } from "./Toast.js";

export function App() {
  // Synchronously kick off the OIDC fragment consumer on the very first render
  // before any LoginScreen / MainApp gating, so a server redirect of the form
  // `https://app/#token=...` populates the auth signals (and clears the hash)
  // without first flashing the login screen.
  useOidcRedirectOnce();
  if (isServerMode && authToken.value === null) {
    return <LoginScreen />;
  }
  return <MainApp />;
}

function useOidcRedirectOnce() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    void consumeOidcRedirect().finally(() => setDone(true));
  }, [done]);
}

function MainApp() {
  const [sharedNote, setSharedNote] = useState<SharedNotePayload | null>(null);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    initRouter();
    startAppSocket();
    loadNotes();
    const stopAutoNotes = initAutoNotes();
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
      stopAutoNotes();
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
  const isSearchView = activeView.value === "search";
  const isAutoNotesView = activeView.value === "autoNotes";
  const isActive = activeView.value === "active";
  const isList = viewMode.value === "list";

  return (
    <div class="flex flex-col h-dvh overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
      <Header />
      <MobileNav />
      <div class="flex flex-1 overflow-hidden relative z-0">
        <Sidebar />
        <main
          class={`flex-1 overflow-y-auto px-4 md:px-6 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-[calc(1.5rem+env(safe-area-inset-bottom))] ${isActive ? "pt-4 md:pt-0 md:-mt-4" : "pt-2"}`}
        >
          {isSearchView ? (
            isList ? (
              <div class="max-w-xl mx-auto">
                <SearchView />
                <NoteGrid />
              </div>
            ) : (
              <>
                <SearchView />
                <NoteGrid />
              </>
            )
          ) : isTagsView ? (
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
          ) : isAutoNotesView ? (
            isList ? (
              <div class="max-w-xl mx-auto">
                <AutoNotesView />
              </div>
            ) : (
              <AutoNotesView />
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
      <ConnectionStatus />
      <Toasts />
      {sharedNote && (
        <SharedNoteDialog
          payload={sharedNote}
          onDone={() => setSharedNote(null)}
        />
      )}
      {dragActive && (
        <div class="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-blue-500/10 backdrop-blur-[2px]">
          <div class="m-6 px-8 py-6 rounded-2xl border-2 border-dashed border-blue-500 bg-white/90 dark:bg-neutral-800/90 shadow-xl flex flex-col items-center gap-2 text-center">
            <Upload class="w-8 h-8 text-blue-600 dark:text-blue-400" />
            <p class="text-lg font-semibold">{t("dropZone.title")}</p>
            <p class="text-sm text-neutral-600 dark:text-neutral-300">
              {t("dropZone.hint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
