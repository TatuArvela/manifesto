import { NoteColor, NoteFont } from "@manifesto/shared";
import {
  ArrowUpCircle,
  ChevronDown,
  Database,
  Download,
  Info,
  KeySquare,
  type LucideIcon,
  Monitor,
  Moon,
  Palette,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  Webhook,
  X,
} from "lucide-preact";
import type { ComponentChildren, JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { noteFontFamilies } from "../colors.js";
import {
  APP_LOGO,
  APP_NAME,
  INSTANCE_LOGO,
  INSTANCE_NAME,
  ORG_LOGO,
  ORG_NAME,
  WELCOME_ENABLED,
} from "../config.js";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { usePresence } from "../hooks/usePresence.js";
import { detectBrowserLocale } from "../i18n/detect.js";
import {
  getColorPickerColors,
  getFontLabel,
  type MessageKey,
  plural,
  t,
} from "../i18n/index.js";
import { type Locale, SUPPORTED_LOCALES } from "../i18n/locales.js";
import { availableUpdate } from "../state/admin.js";
import { currentUser, isServerMode, webhooksEnabled } from "../state/auth.js";
import {
  animations,
  confirmBeforeDelete,
  createNote,
  DARK_HUES,
  type DarkHue,
  type DecimalSeparator,
  type DefaultNoteColor,
  type DefaultNoteFont,
  darkHue,
  decimalSeparator,
  defaultEditMode,
  defaultNoteColor,
  defaultNoteFont,
  deleteAllNotes,
  downloadExport,
  type EditMode,
  formattingToolbar,
  importNotes,
  inlineCalculations,
  locale,
  noteCorners,
  noteQuips,
  type SettingsTab,
  settingsTab,
  showSettings,
  showShortcuts,
  showWelcome,
  stickyTopBar,
  type ThemeMode,
  theme,
} from "../state/index.js";
import { restoreVersions } from "../state/versions.js";
import { importFiles } from "../utils/importExport.js";
import { AccountSettings, hasOwnPassword } from "./AccountSettings.js";
import { ApiTokensSettings } from "./ApiTokensSettings.js";
import { Avatar } from "./Avatar.js";
import { Backdrop } from "./Backdrop.js";
import { BoardBackgroundSetting } from "./BoardBackgroundSetting.js";
import { BrandLogo } from "./BrandLogo.js";
import { Dropdown } from "./Dropdown.js";
import { OrgCredit } from "./OrgCredit.js";
import { Switch, ThreeWayToggle } from "./ToggleSwitch.js";
import { TwoFactorSettings } from "./TwoFactorSettings.js";
import { WebhooksSettings } from "./WebhooksSettings.js";
import { StorageMode } from "./WelcomeDialog.js";

const themeModes: ThemeMode[] = ["system", "light", "dark"];
/** A three-way toggle's track, dark enough to read on a group's tinted panel. */
const toggleTrackClass = "bg-neutral-200/80 dark:bg-neutral-700";
const decimalSeparators: DecimalSeparator[] = ["auto", ".", ","];

/** How long the modal's exit runs; matches the `duration-150` classes below. */
const CLOSE_MS = 150;

// Endonyms never translate: each language's name is rendered in that language.
const LOCALE_ENDONYMS: Record<string, string> = {
  en: "English",
  fi: "Suomi",
};

/** One labelled setting: name on the left, its control on the right. */
function SettingsRow({
  label,
  children,
}: {
  label: string;
  children: ComponentChildren;
}) {
  return (
    <div class="flex items-center justify-between gap-4 min-h-12 px-3 py-2">
      <h4 class="text-sm text-neutral-700 dark:text-neutral-200">{label}</h4>
      {children}
    </div>
  );
}

/**
 * Rows that belong together, with a line between each, under a heading when
 * the group needs a name.
 */
function SettingsGroup({
  title,
  children,
}: {
  title?: string;
  children: ComponentChildren;
}) {
  return (
    <section>
      {title && (
        <h3 class="px-1 pb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          {title}
        </h3>
      )}
      <div class="divide-y divide-neutral-200 dark:divide-white/10">
        {children}
      </div>
    </section>
  );
}

/**
 * One choice in a {@link SettingsSelect}. Options carry their own preview (a
 * leading element, a styled label, or neither), so the select stays
 * presentation-agnostic instead of growing a render hook per kind of setting.
 */
type SettingsOption<T extends string> = {
  value: T;
  label: string;
  /** Rendered ahead of the label, e.g. a colour swatch. */
  preview?: JSX.Element;
  /** Applied to the label, e.g. to show a font in the font it picks. */
  labelStyle?: JSX.CSSProperties;
};

/** The shared innards of the trigger and every menu item. */
function OptionContent<T extends string>({
  option,
}: {
  option: SettingsOption<T>;
}) {
  return (
    <>
      {option.preview}
      <span style={option.labelStyle}>{option.label}</span>
    </>
  );
}

/**
 * A select-style field for a settings row: a labelled trigger with a chevron,
 * with its menu on the shared Dropdown. That puts the panel in the top layer,
 * so the settings modal's scroll container does not clip it, and brings
 * light-dismiss and Escape with it.
 */
function SettingsSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: SettingsOption<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value) ?? {
    value,
    label: value,
  };
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      placement="bottom-end"
      panelClass="py-1 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 min-w-[160px]"
      trigger={
        <button
          type="button"
          class="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors bg-white dark:bg-neutral-700 ring-1 ring-inset ring-neutral-200 dark:ring-0 hover:bg-neutral-100 dark:hover:bg-neutral-600"
          onClick={() => setOpen(!open)}
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <OptionContent option={current} />
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
          <OptionContent option={opt} />
        </button>
      ))}
    </Dropdown>
  );
}

type LanguageOption = "system" | (typeof SUPPORTED_LOCALES)[number];

type TabInfo = {
  label: MessageKey;
  icon: LucideIcon;
};

const TABS: Record<Exclude<SettingsTab, "account">, TabInfo> = {
  twoFactor: { label: "twoFactor.title", icon: ShieldCheck },
  tokens: { label: "tokens.title", icon: KeySquare },
  webhooks: { label: "webhooks.title", icon: Webhook },
  appearance: { label: "settings.group.appearance", icon: Palette },
  features: { label: "settings.group.features", icon: Sparkles },
  data: { label: "settings.group.data", icon: Database },
  about: { label: "settings.group.about", icon: Info },
};

const GENERAL_TABS: SettingsTab[] = ["appearance", "features", "data", "about"];

/** The account's pages this user has: none in open mode or signed out. */
function accountTabs(): SettingsTab[] {
  if (!isServerMode || !currentUser.value) return [];
  const tabs: SettingsTab[] = ["account"];
  if (hasOwnPassword()) tabs.push("twoFactor");
  tabs.push("tokens");
  if (webhooksEnabled.value) tabs.push("webhooks");
  return tabs;
}

const navItemClass =
  "flex items-center gap-3 shrink-0 sm:w-full px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap cursor-pointer transition-colors";

/** The current page looks as the app's own sidebar marks the current view. */
function navItemState(active: boolean) {
  return active
    ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
    : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60";
}

function NavGroup({
  title,
  children,
}: {
  title?: string;
  children: ComponentChildren;
}) {
  return (
    <div class="contents sm:block sm:space-y-0.5 sm:pb-4">
      {title && (
        <p class="hidden sm:block px-3 pb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function NavItem({
  tab,
  active,
  onSelect,
  badge,
}: {
  tab: Exclude<SettingsTab, "account">;
  active: boolean;
  onSelect: (tab: SettingsTab) => void;
  badge?: boolean;
}) {
  const { label, icon: Icon } = TABS[tab];
  return (
    <button
      type="button"
      class={`${navItemClass} ${navItemState(active)}`}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(tab)}
    >
      <Icon class="w-4 h-4 shrink-0" />
      <span class="flex-1">{t(label)}</span>
      {badge && (
        <span class="w-2 h-2 rounded-full bg-blue-500" aria-hidden="true" />
      )}
    </button>
  );
}

/** The signed-in user as the first entry of the sidebar, like a profile card. */
function AccountNavItem({
  active,
  onSelect,
}: {
  active: boolean;
  onSelect: (tab: SettingsTab) => void;
}) {
  const user = currentUser.value;
  if (!user) return null;
  const name = user.displayName || user.username;
  return (
    <button
      type="button"
      class={`${navItemClass} ${navItemState(active)} sm:py-2.5 sm:mb-1`}
      aria-current={active ? "page" : undefined}
      aria-label={t("account.menu")}
      onClick={() => onSelect("account")}
    >
      <Avatar
        name={name}
        color={user.avatarColor}
        class="w-5 h-5 text-[10px] sm:w-9 sm:h-9 sm:text-sm"
      />
      <span class="sm:hidden">{t("account.menu")}</span>
      <span class="hidden sm:block min-w-0 flex-1">
        <span class="block text-sm font-medium truncate">{name}</span>
        <span
          class={`block text-xs font-normal truncate ${active ? "opacity-75" : "text-neutral-500 dark:text-neutral-400"}`}
        >
          {user.email ?? user.username}
        </span>
      </span>
    </button>
  );
}

export function SettingsDialog() {
  const { shown, leaving } = usePresence(showSettings.value || null, CLOSE_MS);
  const isOpen = showSettings.value;

  const handleClose = () => {
    showSettings.value = false;
  };

  // A select menu inside the modal registers after it and closes alone.
  useEscapeStack(isOpen, handleClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

  if (!shown) return null;

  const user = currentUser.value;
  const account = accountTabs();
  // A page that went away (signed out, webhooks turned off) falls back to the
  // first general one rather than showing nothing.
  const tab = [...account, ...GENERAL_TABS].includes(settingsTab.value)
    ? settingsTab.value
    : "appearance";
  const select = (next: SettingsTab) => {
    settingsTab.value = next;
  };
  const update = user?.isAdmin ? availableUpdate.value : null;
  const title = t(tab === "account" ? "account.menu" : TABS[tab].label);

  return (
    <>
      <Backdrop onDismiss={handleClose} closing={leaving} class="z-40" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        class={`fixed inset-0 z-50 flex items-center justify-center sm:p-6 pointer-events-none transition-all duration-150 ${leaving ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <div class="pointer-events-auto flex flex-col sm:flex-row w-full h-full sm:h-[min(42rem,100%)] sm:max-w-3xl overflow-hidden sm:rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-2xl sm:border border-neutral-200 dark:border-neutral-700">
          <aside class="flex flex-col shrink-0 sm:w-64 bg-neutral-50 dark:bg-neutral-900/40 border-b sm:border-b-0 sm:border-r border-neutral-200 dark:border-neutral-700">
            <div class="flex items-center justify-between px-4 sm:px-5 h-14 shrink-0">
              <h2 id="settings-dialog-title" class="text-lg font-semibold">
                {t("settings.title")}
              </h2>
              <button
                type="button"
                class="sm:hidden p-1.5 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                onClick={handleClose}
                aria-label={t("settings.close")}
              >
                <X class="w-5 h-5" />
              </button>
            </div>
            <nav
              aria-label={t("settings.title")}
              class="flex sm:flex-col gap-1 sm:gap-0 overflow-x-auto sm:overflow-x-visible sm:overflow-y-auto px-3 pb-3 sm:pb-2"
            >
              {account.length > 0 && (
                <NavGroup title={t("account.menu")}>
                  <AccountNavItem
                    active={tab === "account"}
                    onSelect={select}
                  />
                  {account
                    .filter((a) => a !== "account")
                    .map((a) => (
                      <NavItem
                        key={a}
                        tab={a as Exclude<SettingsTab, "account">}
                        active={tab === a}
                        onSelect={select}
                      />
                    ))}
                </NavGroup>
              )}
              <NavGroup>
                {GENERAL_TABS.map((g) => (
                  <NavItem
                    key={g}
                    tab={g as Exclude<SettingsTab, "account">}
                    active={tab === g}
                    onSelect={select}
                    badge={g === "about" && update !== null}
                  />
                ))}
              </NavGroup>
            </nav>
          </aside>

          <div class="flex flex-col flex-1 min-w-0 min-h-0">
            <div class="hidden sm:flex items-center justify-between px-6 h-14 shrink-0 border-b border-neutral-200 dark:border-neutral-700">
              <h3 class="text-lg font-semibold">{title}</h3>
              <button
                type="button"
                class="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
                onClick={handleClose}
                aria-label={t("settings.close")}
              >
                <X class="w-5 h-5" />
              </button>
            </div>
            {/* Keyed on the page, so a new one starts scrolled to the top. */}
            <div
              key={tab}
              class="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-6 py-5"
            >
              {tab === "account" && <AccountSettings />}
              {tab === "twoFactor" && <TwoFactorSettings />}
              {tab === "tokens" && <ApiTokensSettings />}
              {tab === "webhooks" && <WebhooksSettings />}
              {tab === "appearance" && <AppearanceSettings />}
              {tab === "features" && <FeaturesSettings />}
              {tab === "data" && <DataSettings />}
              {tab === "about" && <AboutSettings onClose={handleClose} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function AppearanceSettings() {
  const hueOptions: SettingsOption<DarkHue>[] = DARK_HUES.map((hue) => ({
    value: hue,
    label: t(`settings.darkHue.${hue}`),
    preview: (
      <span
        data-dark-hue={hue}
        class="dark-hue-swatch w-9 h-5 shrink-0 rounded ring-1 ring-inset ring-black/10 dark:ring-white/15"
      />
    ),
  }));

  const languageOptions: SettingsOption<LanguageOption>[] = [
    { value: "system", label: t("settings.language.system") },
    ...SUPPORTED_LOCALES.map((l) => ({
      value: l as LanguageOption,
      label: LOCALE_ENDONYMS[l] ?? l,
    })),
  ];
  return (
    <div class="space-y-6">
      <SettingsGroup>
        <SettingsRow label={t("settings.language")}>
          <SettingsSelect
            label={t("settings.language")}
            value={locale.value as LanguageOption}
            options={languageOptions}
            onChange={(next) => {
              locale.value =
                next === "system" ? detectBrowserLocale() : (next as Locale);
            }}
          />
        </SettingsRow>

        <SettingsRow label={t("settings.theme")}>
          <ThreeWayToggle
            trackClass={toggleTrackClass}
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
      </SettingsGroup>

      <SettingsGroup title={t("settings.boardBackground")}>
        <BoardBackgroundSetting />
      </SettingsGroup>

      <SettingsGroup title={t("settings.group.behavior")}>
        <SettingsRow label={t("settings.stickyTopBar")}>
          <Switch
            checked={stickyTopBar.value}
            onChange={(checked) => {
              stickyTopBar.value = checked;
            }}
            label={t("settings.stickyTopBar")}
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

        <SettingsRow label={t("settings.noteQuips")}>
          <Switch
            checked={noteQuips.value}
            onChange={(checked) => {
              noteQuips.value = checked;
            }}
            label={t("settings.noteQuips")}
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}

function FeaturesSettings() {
  return (
    <div class="space-y-6">
      <SettingsGroup>
        <SettingsRow label={t("settings.formattingToolbar")}>
          <Switch
            checked={formattingToolbar.value}
            onChange={(checked) => {
              formattingToolbar.value = checked;
            }}
            label={t("settings.formattingToolbar")}
          />
        </SettingsRow>

        <SettingsRow label={t("settings.confirmBeforeDelete")}>
          <Switch
            checked={confirmBeforeDelete.value}
            onChange={(checked) => {
              confirmBeforeDelete.value = checked;
            }}
            label={t("settings.confirmBeforeDelete")}
          />
        </SettingsRow>

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
              trackClass={toggleTrackClass}
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
      </SettingsGroup>
      <DefaultsSection />
    </div>
  );
}

/** The note a new one starts as, a section of the Features page. */
function DefaultsSection() {
  // Each font previews itself; "random" and the default font have none to show.
  const fontOptions: SettingsOption<DefaultNoteFont>[] = [
    ...Object.values(NoteFont),
    "random" as const,
  ].map((font) => {
    const fontFamily = font === "random" ? "" : noteFontFamilies[font];
    return {
      value: font,
      label: getFontLabel(font),
      labelStyle: fontFamily ? { fontFamily } : undefined,
    };
  });

  // "Default" is the colour's own name, which reads as nonsense for a default
  // colour, so this one list calls it plain.
  const colorOptions: SettingsOption<DefaultNoteColor>[] = [
    ...getColorPickerColors().map((c) => ({
      value: c.value,
      label:
        c.value === NoteColor.Default
          ? t("settings.defaultColor.plain")
          : c.label,
      preview: <span class={`w-4 h-4 shrink-0 rounded-full ${c.swatch}`} />,
    })),
    {
      value: "random",
      label: t("settings.defaultColor.random"),
      preview: (
        <Shuffle class="w-4 h-4 shrink-0 text-neutral-500 dark:text-neutral-400" />
      ),
    },
  ];

  const editModeOptions: SettingsOption<EditMode>[] = [
    { value: "normal", label: t("settings.defaultEditMode.normal") },
    { value: "raw", label: t("settings.defaultEditMode.raw") },
  ];

  return (
    <SettingsGroup title={t("settings.group.defaults")}>
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
        />
      </SettingsRow>

      <SettingsRow label={t("settings.defaultEditMode")}>
        <SettingsSelect
          label={t("settings.defaultEditMode")}
          value={defaultEditMode.value}
          options={editModeOptions}
          onChange={(next) => {
            defaultEditMode.value = next;
          }}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}

/** What Import reads, as a name and a line about it, for the Data page. */
const IMPORT_FORMATS: [MessageKey, MessageKey][] = [
  ["settings.data.importHint.backup", "settings.data.importHint.backupBody"],
  [
    "settings.data.importHint.markdown",
    "settings.data.importHint.markdownBody",
  ],
  ["settings.data.importHint.keep", "settings.data.importHint.keepBody"],
];

function DataSettings() {
  const [dataStatus, setDataStatus] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    const ok = await downloadExport();
    setDataStatus(
      t(ok ? "settings.data.exported" : "settings.data.exportFailed"),
    );
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
      importVersions: (versions) => restoreVersions(versions),
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
    // `deleteAllNotes` reports its own failure; saying "deleted" regardless
    // would contradict the toast it just raised.
    const deleted = await deleteAllNotes();
    setShowDeleteConfirm(false);
    if (deleted) setDeleteStatus(t("settings.data.deleted"));
  };

  return (
    <div class="space-y-4">
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
          accept=".json,.md,.markdown,.zip,image/*"
          multiple
          class="hidden"
          onChange={handleFileChange}
        />
      </div>
      {dataStatus && (
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {dataStatus}
        </p>
      )}
      <div class="text-sm text-neutral-500 dark:text-neutral-400">
        <p>{t("settings.data.importHint")}</p>
        <ul class="mt-2 space-y-1.5 list-disc pl-5">
          {IMPORT_FORMATS.map(([label, body]) => (
            <li key={label}>
              <span class="font-medium text-neutral-700 dark:text-neutral-200">
                {t(label)}
              </span>
              {": "}
              {t(body)}
            </li>
          ))}
        </ul>
      </div>
      <div class="pt-3 border-t border-neutral-200 dark:border-neutral-700">
        {showDeleteConfirm ? (
          <div class="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600">
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
            class="w-full px-3 py-1.5 text-sm bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg font-medium hover:bg-red-200 dark:hover:bg-red-900/50 inline-flex items-center justify-center gap-1.5"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 class="w-4 h-4" />
            {t("settings.data.deleteAll")}
          </button>
        )}
        {deleteStatus && (
          <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
            {deleteStatus}
          </p>
        )}
      </div>
    </div>
  );
}

const linkRowClass =
  "flex items-center gap-2 w-full py-2 text-sm text-left text-blue-700 dark:text-blue-300 hover:underline cursor-pointer";

function AboutSettings({ onClose }: { onClose: () => void }) {
  const user = currentUser.value;
  const update = user?.isAdmin ? availableUpdate.value : null;
  return (
    <div class="space-y-5">
      {/* The app, with its mark and version, then whose copy of it this is.
          The app is always named here, whatever the top bar carries. */}
      <div class="flex items-center gap-3">
        <BrandLogo logo={APP_LOGO} class="w-8 h-8 shrink-0" />
        <div>
          <p class="text-base font-medium">{APP_NAME}</p>
          <p class="text-sm text-neutral-500 dark:text-neutral-400">
            {t("settings.about.version", { version: __APP_VERSION__ })}
          </p>
        </div>
      </div>
      {(INSTANCE_NAME || INSTANCE_LOGO || ORG_NAME || ORG_LOGO) && (
        <div class="space-y-1.5">
          {(INSTANCE_NAME || INSTANCE_LOGO) && (
            <div class="flex items-center gap-2">
              {INSTANCE_LOGO && (
                <BrandLogo
                  logo={INSTANCE_LOGO}
                  class="h-6 w-auto max-w-24 object-contain"
                />
              )}
              {INSTANCE_NAME && <p class="text-sm">{INSTANCE_NAME}</p>}
            </div>
          )}
          <OrgCredit class="justify-start" />
        </div>
      )}
      <StorageMode class="bg-neutral-100 dark:bg-neutral-700/50" />
      {update && (
        <a
          class="flex items-center gap-2 p-3 rounded-lg text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200 hover:underline"
          href={update.url}
          target="_blank"
          rel="noreferrer noopener"
        >
          <ArrowUpCircle class="w-4 h-4 shrink-0" />
          {t("account.updateAvailable", { version: update.latest })}
        </a>
      )}
      <div>
        {/* Beside the source it is the licence of. */}
        <p class="pb-1 text-sm text-neutral-500 dark:text-neutral-400">
          {t("settings.about.license")}
        </p>
        <div class="divide-y divide-neutral-200 dark:divide-neutral-700">
          <a
            class={linkRowClass}
            href="https://github.com/TatuArvela/manifesto"
            target="_blank"
            rel="noreferrer noopener"
          >
            {t("settings.about.repo")}
          </a>
          {WELCOME_ENABLED && (
            <button
              type="button"
              class={linkRowClass}
              onClick={() => {
                onClose();
                showWelcome.value = true;
              }}
            >
              {t("settings.about.welcome")}
            </button>
          )}
          <button
            type="button"
            class={linkRowClass}
            onClick={() => {
              onClose();
              showShortcuts.value = true;
            }}
          >
            {t("settings.about.shortcuts")}
          </button>
        </div>
      </div>
    </div>
  );
}
