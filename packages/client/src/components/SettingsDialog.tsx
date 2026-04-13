import type { Note } from "@manifesto/shared";
import {
  Dices,
  Download,
  Monitor,
  Moon,
  Square,
  Sun,
  Trash2,
  Upload,
} from "lucide-preact";
import { useRef, useState } from "preact/hooks";
import {
  type DefaultNoteColor,
  defaultNoteColor,
  deleteAllNotes,
  exportNotes,
  importNotes,
  showSettings,
  type ThemeMode,
  theme,
} from "../state/index.js";
import { ThreeWayToggle, ToggleSwitch } from "./ToggleSwitch.js";

const themeModes: ThemeMode[] = ["system", "light", "dark"];

export function SettingsDialog() {
  const [dataStatus, setDataStatus] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!showSettings.value) return null;

  const handleExport = () => {
    const json = exportNotes();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `manifesto-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDataStatus("Notes exported");
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data: Note[] = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Invalid format");
      await importNotes(data);
      setDataStatus(
        `Imported ${data.length} note${data.length === 1 ? "" : "s"}`,
      );
    } catch {
      setDataStatus("Import failed — invalid file");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteAll = async () => {
    await deleteAllNotes();
    setShowDeleteConfirm(false);
    setDeleteStatus("All notes deleted");
  };

  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) showSettings.value = false;
      }}
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
        <h2 class="text-lg font-semibold mb-4">Settings</h2>

        {/* Theme */}
        <div class="pb-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-600 dark:text-gray-400">
            Theme
          </h3>
          <ThreeWayToggle
            value={themeModes.indexOf(theme.value)}
            onChange={(i) => {
              theme.value = themeModes[i];
            }}
            options={[
              { icon: <Monitor class="w-4 h-4" />, label: "System" },
              { icon: <Sun class="w-4 h-4" />, label: "Light" },
              { icon: <Moon class="w-4 h-4" />, label: "Dark" },
            ]}
          />
        </div>

        {/* Default note color */}
        <div class="pt-4 pb-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-600 dark:text-gray-400">
            Default Note Color
          </h3>
          <ToggleSwitch
            checked={defaultNoteColor.value === "random"}
            onChange={(checked) => {
              defaultNoteColor.value = checked ? "random" : "plain";
            }}
            iconOff={<Square class="w-4 h-4" />}
            iconOn={<Dices class="w-4 h-4" />}
            labelOff="Plain"
            labelOn="Random"
          />
        </div>

        {/* Import / Export */}
        <div class="pt-4 pb-4 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">
            Data
          </h3>
          <div class="flex gap-2">
            <button
              type="button"
              class="flex-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center justify-center gap-1.5"
              onClick={handleImport}
            >
              <Download class="w-4 h-4" />
              Import Notes
            </button>
            <button
              type="button"
              class="flex-1 px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center justify-center gap-1.5"
              onClick={handleExport}
            >
              <Upload class="w-4 h-4" />
              Export Notes
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              class="hidden"
              onChange={handleFileChange}
            />
          </div>
          {dataStatus && (
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {dataStatus}
            </p>
          )}
        </div>

        {/* Danger zone */}
        <div class="pt-4">
          <h3 class="text-sm font-semibold text-red-600 dark:text-red-400 mb-2">
            Danger Zone
          </h3>
          {showDeleteConfirm ? (
            <div class="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
              <p class="text-sm text-gray-600 dark:text-gray-300 mb-3">
                This will permanently delete all your notes. This action cannot
                be undone.
              </p>
              <div class="flex gap-2">
                <button
                  type="button"
                  class="flex-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
                  onClick={handleDeleteAll}
                >
                  Yes, delete everything
                </button>
                <button
                  type="button"
                  class="flex-1 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
                  onClick={() => setShowDeleteConfirm(false)}
                >
                  Cancel
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
              Delete My Data
            </button>
          )}
          {deleteStatus && (
            <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {deleteStatus}
            </p>
          )}
        </div>

        <div class="mt-4 flex justify-end">
          <button
            type="button"
            class="px-4 py-2 text-sm font-medium rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
            onClick={() => {
              showSettings.value = false;
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
