import { useEffect } from "preact/hooks";
import { filter, loadNotes } from "../state/index.js";
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

  const isTagsView = filter.value === "tags";

  return (
    <div class="flex flex-col h-screen overflow-hidden">
      <Header />
      <div class="flex flex-1 overflow-hidden">
        <Sidebar />
        <main class="flex-1 overflow-y-auto p-4 md:p-6">
          {isTagsView ? <TagsView /> : <NoteInput />}
          <NoteGrid />
        </main>
      </div>
      <SettingsDialog />
    </div>
  );
}
