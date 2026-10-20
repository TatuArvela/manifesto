/**
 * The contract between the service worker and the page for "Share to..." on an
 * installed app (the `share_target` of the manifest). A share is a POST, which
 * no static host can answer. Thus, `sw.ts` takes it, keeps what was shared in a
 * cache, and redirects to the app with `?share-target`. The page then picks it
 * up from there. Both sides read the names below. Thus, they always agree.
 */

export const SHARE_TARGET_ACTION = "share-target";
export const SHARE_TARGET_PARAM = "share-target";
export const SHARE_CACHE = "share-target";
/** Cache keys, resolved against the scope of the service worker. */
export const SHARE_TEXT_KEY = "__share/text";
export const SHARE_IMAGE_KEY_PREFIX = "__share/image/";
/**
 * The longest text field kept from a share. A note is not a place for a full
 * document.
 */
export const MAX_SHARED_TEXT = 100_000;

export interface SharedText {
  title: string;
  text: string;
  url: string;
}

/**
 * What the sharing app sent, as a draft. Apps do not agree where the parts go.
 * Android puts the URL of a page in `text` and its title in `title`. iOS and
 * desktop Chrome use `url`. The URL joins the text, unless the text already
 * contains it. The code drops a title that only repeats the text.
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

/**
 * The maximum selected text that a bookmarklet carries. The address that
 * carries it has a length limit, and servers and browsers do not agree where
 * that limit is.
 */
export const BOOKMARKLET_MAX_TEXT = 4000;

/**
 * A bookmarklet that sends the page on which you click it here, as a share: its
 * title, address and selected text, in the query of `?share-target`
 * (`takeIncomingShare` reads them there). It is for the browsers and pages that
 * the share sheet does not reach, mainly a desktop browser.
 *
 * It opens the app in a new tab, and does not post anything. Thus, it needs no
 * permission on the page, and sends nothing to any address other than that of
 * the app. Nothing is saved until the new note is saved.
 */
export function bookmarkletHref(appUrl: string): string {
  const code = `(()=>{const q=new URLSearchParams({title:document.title,url:location.href,text:String(getSelection()).slice(0,${BOOKMARKLET_MAX_TEXT})});open(${scriptString(appUrl)}+"?${SHARE_TARGET_PARAM}&"+q,"_blank","noopener")})()`;
  return `javascript:${code}`;
}

/**
 * A string as a script literal that stays correct as a `javascript:` URL. The
 * browser percent-decodes such a URL before it runs it. Thus, a `%22` in the
 * string would become a quote that ends the literal too early, and
 * `JSON.stringify` cannot know that. When the code writes `%` (and the
 * characters that end a script or a line in other places) as `\u` escapes, the
 * decode has nothing to change.
 */
function scriptString(value: string): string {
  return JSON.stringify(value).replace(
    /[%<>/\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}
