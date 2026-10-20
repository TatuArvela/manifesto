import { t } from "#/i18n/index.ts";
import type { BoardColorChoice } from "#/state/prefs.ts";

/**
 * The name of a board color. The colored presets have the same names as the
 * note colors of the same hue. Thus, they read them from there.
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
