import type { Note } from "@manifesto/shared";
import { NoteFont } from "@manifesto/shared";
import {
  Dices,
  Download,
  Monitor,
  Moon,
  Square,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type DefaultNoteFont,
  defaultNoteColor,
  defaultNoteFont,
  deleteAllNotes,
  exportNotes,
  importNotes,
  noteFontFamilies,
  showSettings,
  type ThemeMode,
  theme,
} from "../state/index.js";
import { ThreeWayToggle, ToggleSwitch } from "./ToggleSwitch.js";

const themeModes: ThemeMode[] = ["system", "light", "dark"];

const fontOptions: { value: DefaultNoteFont; label: string }[] = [
  { value: NoteFont.Default, label: "Default" },
  { value: NoteFont.PermanentMarker, label: "Permanent Marker" },
  { value: NoteFont.ComicRelief, label: "Comic Relief" },
  { value: "random", label: "Random" },
];

export function SettingsDialog() {
  const [dataStatus, setDataStatus] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  const isOpen = showSettings.value;

  useEffect(() => {
    if (isOpen) {
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      setClosing(true);
    }
  }, [isOpen]);

  const handleClose = () => {
    showSettings.value = false;
  };

  const handleAnimationEnd = () => {
    if (closing) {
      setVisible(false);
      setClosing(false);
    }
  };

  if (!visible) return null;

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
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      <div
        class={`fixed inset-0 z-40 bg-black/50 transition-opacity ${closing ? "opacity-0" : ""}`}
        style={closing ? { transitionDuration: "200ms" } : undefined}
        role="presentation"
        onClick={handleClose}
        onKeyDown={() => {}}
      />

      {/* Side panel */}
      <div
        class={`fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white dark:bg-gray-800 shadow-2xl flex flex-col ${closing ? "animate-slide-out-right" : "animate-slide-in-right"}`}
        onAnimationEnd={handleAnimationEnd}
      >
        <div class="flex items-center justify-between px-6 h-14 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 class="text-lg font-semibold">Settings</h2>
          <button
            type="button"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            onClick={handleClose}
            aria-label="Close settings"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-4">
          {/* Theme */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-gray-600 dark:text-gray-400">Theme</h3>
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
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-gray-600 dark:text-gray-400">
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

          {/* Default note font */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-gray-600 dark:text-gray-400">
              Default Note Font
            </h3>
            <div class="relative">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-lg cursor-pointer bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                style={{
                  fontFamily:
                    defaultNoteFont.value !== "random"
                      ? noteFontFamilies[defaultNoteFont.value] || "inherit"
                      : "inherit",
                }}
                onClick={() => setShowFontMenu(!showFontMenu)}
              >
                {fontOptions.find((o) => o.value === defaultNoteFont.value)
                  ?.label ?? "Default"}
              </button>
              {showFontMenu && (
                <>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
                  <div
                    class="fixed inset-0 z-10"
                    role="presentation"
                    onClick={() => setShowFontMenu(false)}
                    onKeyDown={() => {}}
                  />
                  <div class="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[160px]">
                    {fontOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        class={`block w-full text-left px-4 py-2 text-sm cursor-pointer ${
                          defaultNoteFont.value === opt.value
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-gray-100 dark:hover:bg-gray-700"
                        }`}
                        style={{
                          fontFamily:
                            opt.value !== "random"
                              ? noteFontFamilies[opt.value] || "inherit"
                              : "inherit",
                        }}
                        onClick={() => {
                          defaultNoteFont.value = opt.value;
                          setShowFontMenu(false);
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Import / Export */}
          <div class="pb-4">
            <h3 class="text-sm text-gray-600 dark:text-gray-400 mb-2">Data</h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center justify-center gap-1.5"
                onClick={handleImport}
              >
                <Download class="w-4 h-4" />
                Import Notes
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center justify-center gap-1.5"
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
              {showDeleteConfirm ? (
                <div class="col-span-2 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                  <p class="text-sm text-gray-600 dark:text-gray-300 mb-3">
                    This will permanently delete all your notes. This action
                    cannot be undone.
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
                  class="px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg font-medium hover:bg-red-200 dark:hover:bg-red-900/50 inline-flex items-center justify-center gap-1.5"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <Trash2 class="w-4 h-4" />
                  Delete All
                </button>
              )}
            </div>
            {(dataStatus || deleteStatus) && (
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
                {dataStatus || deleteStatus}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
