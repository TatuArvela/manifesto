import { Monitor, Moon, Sun } from "lucide-preact";
import { Switch, ThreeWayToggle } from "#/components/ToggleSwitch.tsx";
import { t } from "#/i18n/index.ts";
import {
  animations,
  BOARD_COLORS,
  type BoardColor,
  DARK_HUES,
  type DarkHue,
  darkHue,
  LIGHT_HUES,
  type LightHue,
  lightHue,
  noteCorners,
  noteQuips,
  noteTilt,
  stickyTopBar,
  type ThemeMode,
  theme,
} from "#/state/prefs.ts";
import {
  SettingsGroup,
  type SettingsOption,
  SettingsRow,
  SettingsSelect,
  toggleTrackClass,
} from "./SettingsControls.tsx";

const themeModes: ThemeMode[] = ["system", "light", "dark"];

const swatchClass =
  "w-9 h-5 shrink-0 rounded ring-1 ring-inset ring-black/10 dark:ring-white/15";

function isBoardColor(hue: string): hue is BoardColor {
  return (BOARD_COLORS as readonly string[]).includes(hue);
}

export function AppearanceSettings() {
  const lightHueOptions: SettingsOption<LightHue>[] = LIGHT_HUES.map((hue) => ({
    value: hue,
    // The preset colours share their names with the note colours.
    label: isBoardColor(hue)
      ? t(`color.${hue}`)
      : t(`settings.lightHue.${hue}`),
    preview: (
      <span data-light-hue={hue} class={`light-hue-swatch ${swatchClass}`} />
    ),
  }));
  const darkHueOptions: SettingsOption<DarkHue>[] = DARK_HUES.map((hue) => ({
    value: hue,
    label: isBoardColor(hue) ? t(`color.${hue}`) : t(`settings.darkHue.${hue}`),
    preview: (
      <span data-dark-hue={hue} class={`dark-hue-swatch ${swatchClass}`} />
    ),
  }));

  return (
    <div class="space-y-6">
      <SettingsGroup title={t("settings.group.colors")}>
        {/* The theme and its two shades read as one setting, so no line
            parts them. Each shade is dimmed while the theme is pinned to the
            other one, since it would change nothing on screen. */}
        <div>
          <SettingsRow label={t("settings.theme")}>
            <ThreeWayToggle
              trackClass={toggleTrackClass}
              value={themeModes.indexOf(theme.value)}
              onChange={(i) => {
                theme.value = themeModes[i] ?? theme.value;
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

          <SettingsRow label={t("settings.lightHue")}>
            <SettingsSelect
              label={t("settings.lightHue")}
              value={lightHue.value}
              options={lightHueOptions}
              disabled={theme.value === "dark"}
              onChange={(next) => {
                lightHue.value = next;
              }}
            />
          </SettingsRow>

          <SettingsRow label={t("settings.darkHue")}>
            <SettingsSelect
              label={t("settings.darkHue")}
              value={darkHue.value}
              options={darkHueOptions}
              disabled={theme.value === "light"}
              onChange={(next) => {
                darkHue.value = next;
              }}
            />
          </SettingsRow>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t("settings.group.notes")}>
        <SettingsRow label={t("settings.noteTilt")}>
          <SettingsSelect
            label={t("settings.noteTilt")}
            value={noteTilt.value}
            options={[
              { value: "tidy", label: t("settings.noteTilt.tidy") },
              { value: "messy", label: t("settings.noteTilt.messy") },
            ]}
            onChange={(next) => {
              noteTilt.value = next;
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
