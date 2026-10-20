import { type MessageKey, t } from "#/i18n/index.ts";
import type { SettingsTab } from "#/state/ui.ts";

/**
 * What a search in Settings can find: each setting by the label that its row
 * shows, on its page. A setting added to a page gets a line here. If not, the
 * search does not know it. The search always finds the page itself by its name.
 * The result finds its row again by the label (`findSettingRow`). Thus, the
 * label is the key with which the row is drawn.
 */
export const SETTINGS_INDEX: readonly {
  tab: SettingsTab;
  label: MessageKey;
}[] = [
  { tab: "account", label: "account.email" },
  { tab: "signIn", label: "account.changePassword" },
  { tab: "account", label: "account.delete.title" },
  { tab: "language", label: "settings.language" },
  { tab: "language", label: "settings.decimalSeparator" },
  { tab: "appearance", label: "settings.theme" },
  { tab: "appearance", label: "settings.lightHue" },
  { tab: "appearance", label: "settings.darkHue" },
  { tab: "appearance", label: "settings.noteTilt" },
  { tab: "appearance", label: "settings.noteCorners" },
  { tab: "appearance", label: "settings.stickyTopBar" },
  { tab: "appearance", label: "settings.animations" },
  { tab: "appearance", label: "settings.noteQuips" },
  { tab: "features", label: "settings.formattingToolbar" },
  { tab: "features", label: "settings.checkedItemsLast" },
  { tab: "features", label: "settings.checklistProgress" },
  { tab: "features", label: "settings.linkPreviewCards" },
  { tab: "features", label: "settings.openLinksInBrowser" },
  { tab: "features", label: "settings.confirmBeforeDelete" },
  { tab: "features", label: "settings.inlineCalculations" },
  { tab: "features", label: "settings.defaultColor" },
  { tab: "features", label: "settings.defaultFont" },
  { tab: "features", label: "settings.defaultEditMode" },
  { tab: "features", label: "settings.clip.title" },
  { tab: "data", label: "settings.data.import" },
  { tab: "data", label: "settings.data.export" },
  { tab: "data", label: "settings.data.deleteAll" },
];

export interface SettingsHit {
  tab: SettingsTab;
  /** The label of the setting, or null for the page itself. */
  label: string | null;
}

/** Lowercase without accents. Thus, "kayttaytyminen" finds "Käyttäytyminen". */
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The settings and pages whose names contain each word of `query`, among the
 * pages that this user has (`tabs`, with the name of each page). A page found
 * by name comes before the settings on it.
 */
export function searchSettings(
  query: string,
  tabs: readonly { tab: SettingsTab; name: string }[],
): SettingsHit[] {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const matches = (text: string) => {
    const haystack = folded(text);
    return words.every((word) => haystack.includes(word));
  };
  const hits: SettingsHit[] = [];
  for (const { tab, name } of tabs) {
    if (matches(name)) hits.push({ tab, label: null });
    for (const entry of SETTINGS_INDEX) {
      if (entry.tab !== tab) continue;
      const label = t(entry.label);
      if (matches(label)) hits.push({ tab, label });
    }
  }
  return hits;
}

/**
 * The row on the page in `pane` that shows `label`: the heading of a row, the
 * title of a group, or a button whose text is the label.
 */
export function findSettingRow(
  pane: HTMLElement,
  label: string,
): HTMLElement | null {
  const heading = [
    ...pane.querySelectorAll<HTMLElement>("h3, h4, button"),
  ].find((el) => el.textContent?.trim() === label);
  if (!heading) return null;
  return heading.closest<HTMLElement>("[data-setting-row]") ?? heading;
}
