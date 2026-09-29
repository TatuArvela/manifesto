import { NoteColor, NoteFont } from "@manifesto/shared";
import { Shuffle } from "lucide-preact";
import { noteFontFamilies } from "../../colors.js";
import { getColorPickerColors, getFontLabel, t } from "../../i18n/index.js";
import {
  confirmBeforeDelete,
  type DecimalSeparator,
  type DefaultNoteColor,
  type DefaultNoteFont,
  decimalSeparator,
  defaultEditMode,
  defaultNoteColor,
  defaultNoteFont,
  type EditMode,
  formattingToolbar,
  inlineCalculations,
} from "../../state/index.js";
import { Switch, ThreeWayToggle } from "../ToggleSwitch.js";
import {
  SettingsGroup,
  type SettingsOption,
  SettingsRow,
  SettingsSelect,
  toggleTrackClass,
} from "./SettingsControls.js";

const decimalSeparators: DecimalSeparator[] = ["auto", ".", ","];

export function FeaturesSettings() {
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
