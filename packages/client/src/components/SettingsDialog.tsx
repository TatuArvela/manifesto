import { NoteFont } from "@manifesto/shared";
import {
  ChevronDown,
  Download,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteFontFamilies } from "../colors.js";
import { detectBrowserLocale } from "../i18n/detect.js";
import { getFontLabel, plural, t } from "../i18n/index.js";
import { type Locale, SUPPORTED_LOCALES } from "../i18n/locales.js";
import { currentUser, isServerMode, logout } from "../state/auth.js";
import {
  animations,
  createNote,
  DARK_HUES,
  type DarkHue,
  type DecimalSeparator,
  type DefaultNoteColor,
  type DefaultNoteFont,
  darkHue,
  decimalSeparator,
  defaultNoteColor,
  defaultNoteFont,
  deleteAllNotes,
  exportNotes,
  importNotes,
  inlineCalculations,
  locale,
  noteCorners,
  noteQuips,
  showSettings,
  type ThemeMode,
  theme,
} from "../state/index.js";
import { importFiles } from "../utils/importExport.js";
import { Dropdown, hasOpenAutoPopover } from "./Dropdown.js";
import { Switch, ThreeWayToggle } from "./ToggleSwitch.js";

const themeModes: ThemeMode[] = ["system", "light", "dark"];
const decimalSeparators: DecimalSeparator[] = ["auto", ".", ","];

// Endonyms never translate — each language's name is rendered in that language.
const LOCALE_ENDONYMS: Record<string, string> = {
  en: "English",
  fi: "Suomi",
};

/** A titled group of settings rows — Appearance, Defaults, Features, Data. */
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class="mb-6">
      <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 pb-1.5 mb-3 border-b border-neutral-200 dark:border-neutral-700">
        {title}
      </h3>
      <div class="space-y-4">{children}</div>
    </section>
  );
}

/** One labelled setting: name on the left, its control on the right. */
function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div class="flex items-center justify-between gap-4">
      <h4 class="text-sm text-neutral-600 dark:text-neutral-400">{label}</h4>
      {children}
    </div>
  );
}

/**
 * A select-style field for a settings row: a labelled trigger with a chevron,
 * with its menu on the shared Dropdown. That puts the panel in the top layer,
 * so it is no longer clipped by the settings panel's scroll container, and
 * brings light-dismiss and Escape with it instead of the hand-rolled
 * full-screen backdrop each of these used to render.
 */
function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  styleFor,
  swatchFor,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  styleFor?: (value: T) => JSX.CSSProperties | undefined;
  /** Renders a small preview dot ahead of the label, e.g. for colour options. */
  swatchFor?: (value: T) => JSX.Element;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      panelClass="py-1 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[160px]"
      trigger={
        <button
          type="button"
          class="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600"
          onClick={() => setOpen(!open)}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {swatchFor?.(value)}
          <span style={styleFor?.(value)}>{current?.label ?? value}</span>
          <ChevronDown
            class={`w-4 h-4 shrink-0 text-neutral-500 dark:text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      }
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          class={`flex w-full items-center gap-2 text-left px-4 py-2 text-sm cursor-pointer ${
            value === opt.value
              ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-700"
          }`}
          onClick={() => {
            onChange(opt.value);
            setOpen(false);
          }}
        >
          {swatchFor?.(opt.value)}
          <span style={styleFor?.(opt.value)}>{opt.label}</span>
        </button>
      ))}
    </Dropdown>
  );
}

type LanguageOption = "system" | (typeof SUPPORTED_LOCALES)[number];

export function SettingsDialog() {
  const [dataStatus, setDataStatus] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
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

  const colorOptions: { value: DefaultNoteColor; label: string }[] = [
    { value: "plain", label: t("settings.defaultColor.plain") },
    { value: "random", label: t("settings.defaultColor.random") },
  ];

  const hueOptions: { value: DarkHue; label: string }[] = DARK_HUES.map(
    (hue) => ({ value: hue, label: t(`settings.darkHue.${hue}`) }),
  );

  const languageOptions: { value: LanguageOption; label: string }[] = [
    { value: "system", label: t("settings.language.system") },
    ...SUPPORTED_LOCALES.map((l) => ({
      value: l as LanguageOption,
      label: LOCALE_ENDONYMS[l] ?? l,
    })),
  ];
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
      if (e.key !== "Escape") return;
      // A select menu inside the panel is a popover that light-dismisses on
      // Escape itself; let it close alone rather than taking the panel with it.
      if (hasOpenAutoPopover()) return;
      handleClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen]);

  // animationend bubbles, so ignore anything a descendant fires — only the
  // panel's own slide-out marks the close as finished.
  const handleAnimationEnd = (e: AnimationEvent) => {
    if (e.target !== e.currentTarget) return;
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
        class="settings-backdrop fixed inset-0 z-40 bg-black/50"
        data-closing={closing ? "true" : undefined}
        role="presentation"
        onClick={handleClose}
        onKeyDown={() => {}}
      />

      {/* Side panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        class="settings-panel fixed inset-y-0 right-0 z-50 w-full max-w-sm bg-white dark:bg-neutral-800 shadow-2xl flex flex-col"
        data-closing={closing ? "true" : undefined}
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
          <SettingsSection title={t("settings.group.appearance")}>
            <SettingsRow label={t("settings.language")}>
              <SettingsSelect
                label={t("settings.language")}
                value={locale.value as LanguageOption}
                options={languageOptions}
                onChange={(next) => {
                  locale.value =
                    next === "system"
                      ? detectBrowserLocale()
                      : (next as Locale);
                }}
              />
            </SettingsRow>

            <SettingsRow label={t("settings.theme")}>
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
            </SettingsRow>

            <SettingsRow label={t("settings.darkHue")}>
              <SettingsSelect
                label={t("settings.darkHue")}
                value={darkHue.value}
                options={hueOptions}
                onChange={(next) => {
                  darkHue.value = next;
                }}
                swatchFor={(hue) => (
                  <span
                    data-dark-hue={hue}
                    class="dark-hue-swatch w-9 h-5 shrink-0 rounded ring-1 ring-inset ring-black/10 dark:ring-white/15"
                  />
                )}
              />
            </SettingsRow>

            <SettingsRow label={t("settings.noteCorners")}>
              <Switch
                checked={noteCorners.value === "rounded"}
                onChange={(checked) => {
                  noteCorners.value = checked ? "rounded" : "straight";
                }}
                label={t("settings.noteCorners")}
              />
            </SettingsRow>

            <SettingsRow label={t("settings.animations")}>
              <Switch
                checked={animations.value}
                onChange={(checked) => {
                  animations.value = checked;
                }}
                label={t("settings.animations")}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={t("settings.group.defaults")}>
            <SettingsRow label={t("settings.defaultColor")}>
              <SettingsSelect
                label={t("settings.defaultColor")}
                value={defaultNoteColor.value}
                options={colorOptions}
                onChange={(next) => {
                  defaultNoteColor.value = next;
                }}
              />
            </SettingsRow>

            <SettingsRow label={t("settings.defaultFont")}>
              <SettingsSelect
                label={t("settings.defaultFont")}
                value={defaultNoteFont.value}
                options={fontOptions}
                onChange={(next) => {
                  defaultNoteFont.value = next;
                }}
                styleFor={(v) => ({
                  fontFamily:
                    v !== "random"
                      ? noteFontFamilies[v] || "inherit"
                      : "inherit",
                })}
              />
            </SettingsRow>

            <SettingsRow label={t("settings.noteQuips")}>
              <Switch
                checked={noteQuips.value}
                onChange={(checked) => {
                  noteQuips.value = checked;
                }}
                label={t("settings.noteQuips")}
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title={t("settings.group.features")}>
            <SettingsRow label={t("settings.inlineCalculations")}>
              <Switch
                checked={inlineCalculations.value}
                onChange={(checked) => {
                  inlineCalculations.value = checked;
                }}
                label={t("settings.inlineCalculations")}
              />
            </SettingsRow>

            {/* Only relevant while inline calculations are on */}
            {inlineCalculations.value && (
              <SettingsRow label={t("settings.decimalSeparator")}>
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
              </SettingsRow>
            )}
          </SettingsSection>

          <SettingsSection title={t("settings.group.data")}>
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
              <p class="text-xs text-neutral-500 dark:text-neutral-400">
                {dataStatus || deleteStatus}
              </p>
            )}
          </SettingsSection>

          {isServerMode && currentUser.value && (
            <SettingsSection title={t("settings.group.account")}>
              <SettingsRow label={currentUser.value.username}>
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
              </SettingsRow>
            </SettingsSection>
          )}

          <div class="pt-2 border-t border-neutral-200 dark:border-neutral-700 text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
            <p>
              {t("settings.about.version")} v{__APP_VERSION__}
            </p>
            <p>
              <a
                class="underline hover:text-neutral-700 dark:hover:text-neutral-300"
                href="https://github.com/TatuArvela/manifesto"
                target="_blank"
                rel="noreferrer noopener"
              >
                {t("settings.about.repo")}
              </a>
              {" · "}
              {t("settings.about.license")}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
