import { effect } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { decodeShareFromHash, type SharedNotePayload } from "../sharing.js";
import {
  activeView,
  editingNoteId,
  loadNotes,
  notes,
  updateNote,
  viewMode,
} from "../state/index.js";
import { initReminderScheduler } from "../state/reminderScheduler.js";
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
    </div>
  );
}
