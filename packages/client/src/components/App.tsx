import { useEffect } from "preact/hooks";
import { activeView, loadNotes, viewMode } from "../state/index.js";
import { Header } from "./Header.js";
import { NoteGrid } from "./NoteGrid.js";
import { NoteInput } from "./NoteInput.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { Sidebar } from "./Sidebar.js";
import { TagsView } from "./TagsView.js";
import { Toasts } from "./Toast.js";

export function App() {
  useEffect(() => {
    loadNotes();
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
            <>
              <TagsView />
              <NoteGrid />
            </>
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
      <Toasts />
    </div>
  );
}
