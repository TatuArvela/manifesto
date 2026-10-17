import { t } from "#/i18n/index.ts";
import type { BoardColorChoice } from "#/state/prefs.ts";

/**
 * A board colour's name. The coloured presets share their names with the
 * note colours of the same hue, so they read them from there.
 */
export function boardColorLabel(choice: BoardColorChoice): string {
  switch (choice) {
    case "none":
    case "white":
    case "gray":
    case "black":
    case "custom":
    case "random":
      return t(`settings.boardBackground.${choice}`);
    default:
      return t(`color.${choice}`);
  }
}
