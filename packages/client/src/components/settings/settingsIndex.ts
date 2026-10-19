import { type MessageKey, t } from "#/i18n/index.ts";
import type { SettingsTab } from "#/state/ui.ts";

/**
 * What a search in Settings can find: each setting by the label its row
 * shows, on the page it is on. A setting added to a page gets a line here, or
 * the search does not know it; the page itself is always found by its name.
 * The label is how the result finds its row again (`findSettingRow`), so it
 * is the key the row is drawn with.
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
  /** The setting's label, or null for the page itself. */
  label: string | null;
}

/** Lower case with the accents taken off, so "kayttaytyminen" finds "Käyttäytyminen". */
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The settings and pages whose names hold every word of `query`, among the
 * pages this user has (`tabs`, with each page's name). A page found by name
 * comes before the settings on it.
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
 * The row on the page in `pane` that shows `label`: a row's heading, a
 * group's title or a button, whose text is the label.
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
