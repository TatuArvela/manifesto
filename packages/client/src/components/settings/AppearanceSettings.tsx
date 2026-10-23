import { Switch } from "#/components/ToggleSwitch.tsx";
import { t } from "#/i18n/index.ts";
import {
  animations,
  complexShadows,
  noteCorners,
  noteQuips,
  stickyTopBar,
} from "#/state/prefs.ts";
import { BoardStylePicker } from "./BoardStylePicker.tsx";
import { SettingsGroup, SettingsRow } from "./SettingsControls.tsx";
import { ThemePicker } from "./ThemePicker.tsx";

export function AppearanceSettings() {
  return (
    <div class="space-y-6">
      <SettingsGroup title={t("settings.group.colors")}>
        <SettingsRow label={t("settings.theme")} alignTop>
          <ThemePicker />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t("settings.group.notes")}>
        <SettingsRow label={t("settings.noteTilt")} alignTop>
          <BoardStylePicker />
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

        <SettingsRow label={t("settings.complexShadows")}>
          <Switch
            checked={complexShadows.value}
            onChange={(checked) => {
              complexShadows.value = checked;
            }}
            label={t("settings.complexShadows")}
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
