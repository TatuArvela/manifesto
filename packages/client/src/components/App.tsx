import { useEffect } from "preact/hooks";
import { activeView, loadNotes, viewMode } from "../state/index.js";
import { Header } from "./Header.js";
import { NoteGrid } from "./NoteGrid.js";
import { NoteInput } from "./NoteInput.js";
import { SettingsDialog } from "./SettingsDialog.js";
import { Sidebar } from "./Sidebar.js";
import { TagsView } from "./TagsView.js";

export function App() {
  useEffect(() => {
    loadNotes();
  }, []);

  const isTagsView = activeView.value === "tags";
  const isList = viewMode.value === "list";

  return (
    <div class="flex flex-col h-screen overflow-hidden">
      <Header />
      <div class="flex flex-1 overflow-hidden -mt-4 relative">
        <Sidebar />
        <main class="flex-1 overflow-y-auto px-4 md:px-6 pb-4 md:pb-6">
          {isTagsView ? (
            <TagsView />
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
    </div>
  );
}
