/**
 * Handing a link from the installed app to the system's own browser. An
 * installed app on a phone opens a link in a view of its own (an in-app
 * browser over the app), which has none of the reader's tabs, bookmarks or
 * sign-ins. The web gives a page no say in that, but each phone has an
 * address that asks the system to open a link in its browser instead:
 *
 * - iOS and iPadOS 17 and later: the `x-safari-https:` scheme, which opens
 *   Safari whatever the default browser is.
 * - Android: an `intent:` address with no package, which the system hands
 *   to the default browser, falling back to the plain link where it cannot.
 *
 * Elsewhere (a desktop window, a tab) a new tab already is the browser.
 */

export type LinkPlatform = "ios" | "android" | "other";

/** The phone's system, as far as handing off a link is concerned. */
export function linkPlatform(
  nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> = navigator,
): LinkPlatform {
  const ua = nav.userAgent;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // iPadOS asks for desktop sites and so calls itself a Mac, the only Mac
  // with a touch screen.
  if (/Macintosh/.test(ua) && nav.maxTouchPoints > 1) return "ios";
  return "other";
}

/** Whether the app is running installed, in a window of its own. */
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
 * new tab already is the browser.
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
