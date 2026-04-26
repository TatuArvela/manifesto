import { NoteFont } from "@manifesto/shared";
import {
  Calculator,
  Dices,
  Download,
  LogOut,
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
import { currentUser, isServerMode, logout } from "../state/auth.js";
import {
  createNote,
  type DecimalSeparator,
  type DefaultNoteFont,
  decimalSeparator,
  defaultNoteColor,
  defaultNoteFont,
  deleteAllNotes,
  exportNotes,
  importNotes,
  inlineCalculations,
  locale,
  showSettings,
  type ThemeMode,
  theme,
} from "../state/index.js";
import { importFiles } from "../utils/importExport.js";
import { ThreeWayToggle, ToggleSwitch } from "./ToggleSwitch.js";

const themeModes: ThemeMode[] = ["system", "light", "dark"];
const decimalSeparators: DecimalSeparator[] = ["auto", ".", ","];

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

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

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
    const files = (e.target as HTMLInputElement).files;
    if (!files || files.length === 0) return;
    const summary = await importFiles([...files], {
      createNote: (input) => createNote(input),
      importBulk: (notes) => importNotes(notes),
    });
    if (summary.bulkCount > 0) {
      setDataStatus(plural("settings.data.importedCount", summary.bulkCount));
    } else if (summary.singleCount > 0) {
      setDataStatus(
        summary.singleCount === 1
          ? t("settings.data.importedSingle")
          : plural("settings.data.importedCount", summary.singleCount),
      );
    } else {
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
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        class={`fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white dark:bg-neutral-800 shadow-2xl flex flex-col ${closing ? "animate-slide-out-right" : "animate-slide-in-right"}`}
        onAnimationEnd={handleAnimationEnd}
      >
        <div class="flex items-center justify-between px-6 h-14 border-b border-neutral-200 dark:border-neutral-700 shrink-0">
          <h2 id="settings-dialog-title" class="text-lg font-semibold">
            {t("settings.title")}
          </h2>
          <button
            type="button"
            class="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
            onClick={handleClose}
            aria-label={t("settings.close")}
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-4">
          {/* Theme */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-neutral-600 dark:text-neutral-400">
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
            <h3 class="text-sm text-neutral-600 dark:text-neutral-400">
              {t("settings.language")}
            </h3>
            <div class="relative">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-lg cursor-pointer bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
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
                  <div class="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 z-20 min-w-[160px]">
                    {languageOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        class={`block w-full text-left px-4 py-2 text-sm cursor-pointer ${
                          opt.value !== "system" && locale.value === opt.value
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
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
            <h3 class="text-sm text-neutral-600 dark:text-neutral-400">
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
            <h3 class="text-sm text-neutral-600 dark:text-neutral-400">
              {t("settings.defaultFont")}
            </h3>
            <div class="relative">
              <button
                type="button"
                class="px-3 py-1.5 text-sm rounded-lg cursor-pointer bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors"
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
                  <div class="absolute right-0 top-full mt-1 py-1 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 z-20 min-w-[160px]">
                    {fontOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        class={`block w-full text-left px-4 py-2 text-sm cursor-pointer ${
                          defaultNoteFont.value === opt.value
                            ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                            : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
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

          {/* Inline calculations */}
          <div class="pb-4 flex items-center justify-between">
            <h3 class="text-sm text-neutral-600 dark:text-neutral-400">
              {t("settings.inlineCalculations")}
            </h3>
            <ToggleSwitch
              checked={inlineCalculations.value}
              onChange={(checked) => {
                inlineCalculations.value = checked;
              }}
              iconOff={<Calculator class="w-4 h-4" />}
              iconOn={<Calculator class="w-4 h-4" />}
              labelOff={t("settings.inlineCalculations.off")}
              labelOn={t("settings.inlineCalculations.on")}
            />
          </div>

          {/* Decimal separator (only relevant while inline calculations are on) */}
          {inlineCalculations.value && (
            <div class="pb-4 flex items-center justify-between">
              <h3 class="text-sm text-neutral-600 dark:text-neutral-400">
                {t("settings.decimalSeparator")}
              </h3>
              <ThreeWayToggle
                value={decimalSeparators.indexOf(decimalSeparator.value)}
                onChange={(i) => {
                  decimalSeparator.value = decimalSeparators[i];
                }}
                options={[
                  {
                    icon: <span class="text-xs font-semibold">A</span>,
                    label: t("settings.decimalSeparator.auto"),
                  },
                  {
                    icon: <span class="text-base leading-none">.</span>,
                    label: t("settings.decimalSeparator.dot"),
                  },
                  {
                    icon: <span class="text-base leading-none">,</span>,
                    label: t("settings.decimalSeparator.comma"),
                  },
                ]}
              />
            </div>
          )}

          {/* Import / Export */}
          <div class="pb-4">
            <h3 class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
              {t("settings.data")}
            </h3>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 rounded-lg font-medium hover:bg-neutral-200 dark:hover:bg-neutral-600 inline-flex items-center justify-center gap-1.5"
                onClick={handleImport}
              >
                <Download class="w-4 h-4" />
                {t("settings.data.import")}
              </button>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 rounded-lg font-medium hover:bg-neutral-200 dark:hover:bg-neutral-600 inline-flex items-center justify-center gap-1.5"
                onClick={handleExport}
              >
                <Upload class="w-4 h-4" />
                {t("settings.data.export")}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.md,.markdown"
                multiple
                class="hidden"
                onChange={handleFileChange}
              />
              {showDeleteConfirm ? (
                <div class="col-span-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600">
                  <p class="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
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
                      class="flex-1 px-3 py-1.5 text-sm bg-neutral-200 dark:bg-neutral-600 rounded-lg font-medium hover:bg-neutral-300 dark:hover:bg-neutral-500"
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
              <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                {dataStatus || deleteStatus}
              </p>
            )}
          </div>

          {isServerMode && currentUser.value && (
            <div>
              <h3 class="text-sm text-neutral-600 dark:text-neutral-400 mb-2">
                {currentUser.value.username}
              </h3>
              <button
                type="button"
                class="px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 rounded-lg font-medium hover:bg-neutral-200 dark:hover:bg-neutral-600 inline-flex items-center justify-center gap-1.5"
                onClick={() => {
                  void logout();
                  handleClose();
                }}
              >
                <LogOut class="w-4 h-4" />
                {t("login.signOut")}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
