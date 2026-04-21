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
import { noteFontFamilies } from "../colors.js";
import { detectBrowserLocale } from "../i18n/detect.js";
import { getFontLabel, plural, t } from "../i18n/index.js";
import { SUPPORTED_LOCALES } from "../i18n/locales.js";
import {
  type DefaultNoteFont,
  defaultNoteColor,
  defaultNoteFont,
  deleteAllNotes,
  exportNotes,
  importNotes,
  locale,
  showSettings,
  type ThemeMode,
  theme,
} from "../state/index.js";
import { ThreeWayToggle, ToggleSwitch } from "./ToggleSwitch.js";

const themeModes: ThemeMode[] = ["system", "light", "dark"];

// Endonyms never translate — each language's name is rendered in that language.
const LOCALE_ENDONYMS: Record<string, string> = {
  en: "English",
  fi: "Suomi",
};

type LanguageOption = "system" | (typeof SUPPORTED_LOCALES)[number];

export function SettingsDialog() {
  const [dataStatus, setDataStatus] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFontMenu, setShowFontMenu] = useState(false);
  const [showLanguageMenu, setShowLanguageMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  const fontOptions: { value: DefaultNoteFont; label: string }[] = [
    { value: NoteFont.Default, label: getFontLabel(NoteFont.Default) },
    {
      value: NoteFont.PermanentMarker,
      label: getFontLabel(NoteFont.PermanentMarker),
    },
    { value: NoteFont.ComicRelief, label: getFontLabel(NoteFont.ComicRelief) },
    { value: "random", label: getFontLabel("random") },
  ];

  const languageOptions: { value: LanguageOption; label: string }[] = [
    { value: "system", label: t("settings.language.system") },
    ...SUPPORTED_LOCALES.map((l) => ({
      value: l as LanguageOption,
      label: LOCALE_ENDONYMS[l] ?? l,
    })),
  ];
  const currentLanguageLabel =
    LOCALE_ENDONYMS[locale.value] ?? String(locale.value);

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
    setDataStatus(t("settings.data.exported"));
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Invalid format");
      // Validate each note has the required fields and correct types
      for (const item of data) {
        if (
          typeof item !== "object" ||
          item === null ||
          typeof item.id !== "string" ||
          typeof item.title !== "string" ||
          typeof item.content !== "string" ||
          typeof item.createdAt !== "string" ||
          typeof item.updatedAt !== "string" ||
          !Array.isArray(item.tags)
        ) {
          throw new Error("Invalid note schema");
        }
      }
      await importNotes(data as Note[]);
      setDataStatus(plural("settings.data.importedCount", data.length));
    } catch {
      setDataStatus(t("settings.data.importFailed"));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDeleteAll = async () => {
    await deleteAllNotes();
    setShowDeleteConfirm(false);
    setDeleteStatus(t("settings.data.deleted"));
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
          <h2 class="text-lg font-semibold">{t("settings.title")}</h2>
          <button
            type="button"
            class="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            onClick={handleClose}
            aria-label={t("settings.close")}
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-4">
          {/* Theme */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-gray-600 dark:text-gray-400">
              {t("settings.theme")}
            </h3>
            <ThreeWayToggle
              value={themeModes.indexOf(theme.value)}
              onChange={(i) => {
                theme.value = themeModes[i];
              }}
              options={[
                {
                  icon: <Monitor class="w-4 h-4" />,
                  label: t("settings.theme.system"),
                },
                {
                  icon: <Sun class="w-4 h-4" />,
                  label: t("settings.theme.light"),
                },
                {
                  icon: <Moon class="w-4 h-4" />,
                  label: t("settings.theme.dark"),
                },
              ]}
            />
          </div>

          {/* Language */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-gray-600 dark:text-gray-400">
              {t("settings.language")}
            </h3>
            <div class="relative">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-lg cursor-pointer bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                onClick={() => setShowLanguageMenu(!showLanguageMenu)}
              >
                {currentLanguageLabel}
              </button>
              {showLanguageMenu && (
                <>
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
                  <div
                    class="fixed inset-0 z-10"
                    role="presentation"
                    onClick={() => setShowLanguageMenu(false)}
                    onKeyDown={() => {}}
                  />
                  <div class="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-20 min-w-[160px]">
                    {languageOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        class={`block w-full text-left px-4 py-2 text-sm cursor-pointer ${
                          opt.value !== "system" && locale.value === opt.value
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-gray-100 dark:hover:bg-gray-700"
                        }`}
                        onClick={() => {
                          locale.value =
                            opt.value === "system"
                              ? detectBrowserLocale()
                              : opt.value;
                          setShowLanguageMenu(false);
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

          {/* Default note color */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-gray-600 dark:text-gray-400">
              {t("settings.defaultColor")}
            </h3>
            <ToggleSwitch
              checked={defaultNoteColor.value === "random"}
              onChange={(checked) => {
                defaultNoteColor.value = checked ? "random" : "plain";
              }}
              iconOff={<Square class="w-4 h-4" />}
              iconOn={<Dices class="w-4 h-4" />}
              labelOff={t("settings.defaultColor.plain")}
              labelOn={t("settings.defaultColor.random")}
            />
          </div>

          {/* Default note font */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-gray-600 dark:text-gray-400">
              {t("settings.defaultFont")}
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
                  ?.label ?? getFontLabel(NoteFont.Default)}
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
            <h3 class="text-sm text-gray-600 dark:text-gray-400 mb-2">
              {t("settings.data")}
            </h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center justify-center gap-1.5"
                onClick={handleImport}
              >
                <Download class="w-4 h-4" />
                {t("settings.data.import")}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 rounded-lg font-medium hover:bg-gray-200 dark:hover:bg-gray-600 inline-flex items-center justify-center gap-1.5"
                onClick={handleExport}
              >
                <Upload class="w-4 h-4" />
                {t("settings.data.export")}
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
                    {t("settings.data.deleteConfirm")}
                  </p>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      class="flex-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
                      onClick={handleDeleteAll}
                    >
                      {t("settings.data.deleteYes")}
                    </button>
                    <button
                      type="button"
                      class="flex-1 px-3 py-1.5 text-sm bg-gray-200 dark:bg-gray-600 rounded-lg font-medium hover:bg-gray-300 dark:hover:bg-gray-500"
                      onClick={() => setShowDeleteConfirm(false)}
                    >
                      {t("settings.data.cancel")}
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
                  {t("settings.data.deleteAll")}
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
