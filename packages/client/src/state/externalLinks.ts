import {
  isInstalledApp,
  linkPlatform,
  systemBrowserHref,
} from "#/utils/systemBrowser.ts";
import { openLinksInBrowser } from "./prefs.ts";

/** Whether "Open Links in Browser" can change anything on this device. */
export function canOpenInSystemBrowser(): boolean {
  return isInstalledApp() && linkPlatform() !== "other";
}

/**
 * The address to send a web link to instead of opening it in the app's own
 * view, with "Open Links in Browser" on in the installed app; null when the
 * link opens as it always has.
 */
export function handOffHref(href: string): string | null {
  if (!openLinksInBrowser.value || !canOpenInSystemBrowser()) return null;
  return systemBrowserHref(href, linkPlatform());
}

/** Opens a link from the app: in a new tab, or in the system browser. */
export function openExternalLink(href: string): void {
  const handOff = handOffHref(href);
  if (handOff) {
    window.location.assign(handOff);
    return;
  }
  window.open(href, "_blank", "noopener,noreferrer");
}
