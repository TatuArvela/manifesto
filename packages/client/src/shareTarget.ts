/**
 * The contract between the service worker and the page for "Share to..." on
 * an installed app (the manifest's `share_target`). A share is a POST, which
 * no static host can answer, so `sw.ts` takes it, parks what was shared in a
 * cache, and redirects to the app with `?share-target`. The page then picks
 * it up from there. Both sides read the names below, so they cannot drift.
 */

export const SHARE_TARGET_ACTION = "share-target";
export const SHARE_TARGET_PARAM = "share-target";
export const SHARE_CACHE = "share-target";
/** Cache keys, resolved against the service worker scope. */
export const SHARE_TEXT_KEY = "__share/text";
export const SHARE_IMAGE_KEY_PREFIX = "__share/image/";
/** Longest text field kept from a share; a note is not a document dump. */
export const MAX_SHARED_TEXT = 100_000;

export interface SharedText {
  title: string;
  text: string;
  url: string;
}

/**
 * What the sharing app sent, as a draft. Apps disagree about where things go:
 * Android puts a page's URL in `text` and its title in `title`, iOS and
 * desktop Chrome use `url`. The URL joins the text unless the text already
 * holds it, and a title that only repeats the text is dropped.
 */
export function sharedTextToDraft(shared: SharedText): {
  title: string;
  content: string;
} {
  const title = shared.title.trim();
  const text = shared.text.trim();
  const url = shared.url.trim();
  const parts = [text];
  if (url && !text.includes(url)) parts.push(url);
  const content = parts.filter(Boolean).join("\n\n");
  return { title: title === content || title === url ? "" : title, content };
}

export function sharedTextFromForm(form: FormData): SharedText {
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.slice(0, MAX_SHARED_TEXT) : "";
  };
  return { title: field("title"), text: field("text"), url: field("url") };
}

/** Most selected text a bookmarklet carries; the address it rides in has a
 * length limit, and servers and browsers disagree about where it lies. */
export const BOOKMARKLET_MAX_TEXT = 4000;

/**
 * A bookmarklet that sends the page it is clicked on here, as a share: its
 * title, address and any selected text, in the query of `?share-target`
 * (`takeIncomingShare` reads them there). For browsers and pages the share
 * sheet does not reach, a desktop browser above all.
 *
 * It opens the app in a new tab rather than posting anything, so it needs no
 * permission on the page and sends nothing anywhere but the app's own
 * address; nothing is saved until the new note is.
 */
export function bookmarkletHref(appUrl: string): string {
  const code = `(()=>{const q=new URLSearchParams({title:document.title,url:location.href,text:String(getSelection()).slice(0,${BOOKMARKLET_MAX_TEXT})});open(${JSON.stringify(appUrl)}+"?${SHARE_TARGET_PARAM}&"+q,"_blank","noopener")})()`;
  return `javascript:${code}`;
}
