/**
 * Gives a link from the installed app to the own browser of the system. An
 * installed app on a phone opens a link in its own view (an in-app browser over
 * the app), which has none of the tabs, bookmarks or sign-ins of the reader.
 * The web gives a page no control of that. But each phone has an address that
 * asks the system to open a link in its browser:
 *
 * - iOS and iPadOS 17 and later: the `x-safari-https:` scheme, which opens
 *   Safari, whatever the default browser is.
 * - Android: an `intent:` address with no package, which the system gives to
 *   the default browser. Where it cannot, the plain link is used.
 *
 * In other places (a desktop window, a tab), a new tab is already the browser.
 */

export type LinkPlatform = "ios" | "android" | "other";

/**
 * The system of the phone, as much as it is important for the handover of a
 * link.
 */
export function linkPlatform(
  nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator,
): LinkPlatform {
  const ua = nav.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // iPadOS asks for desktop sites, and thus says that it is a Mac, the only Mac
  // with a touch screen.
  if (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) return "ios";
  return "other";
}

/** If the app runs installed, in its own window. */
export function isInstalledApp(): boolean {
  if ((navigator as { standalone?: boolean }).standalone === true) return true;
  try {
    return ["standalone", "fullscreen", "minimal-ui"].some(
      (mode) => matchMedia(`(display-mode: ${mode})`).matches,
    );
  } catch {
    return false;
  }
}

/**
 * The address that opens `href` in the system browser on `platform`, or null
 * when there is none: a link that is not a web address, or a platform where a
 * new tab is already the browser.
 */
export function systemBrowserHref(
  href: string,
  platform: LinkPlatform,
): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const scheme = url.protocol.slice(0, -1);
  const rest = url.href.slice(url.protocol.length + 2);
  if (platform === "ios") return `x-safari-${scheme}://${rest}`;
  if (platform === "android") {
    // The intent's own fields follow its `#`, so the link's fragment cannot
    // ride in the address part; it goes with the fallback, which is whole.
    const withoutHash = `${url.host}${url.pathname}${url.search}`;
    const fallback = encodeURIComponent(url.href);
    return `intent://${withoutHash}#Intent;scheme=${scheme};action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end`;
  }
  return null;
}
