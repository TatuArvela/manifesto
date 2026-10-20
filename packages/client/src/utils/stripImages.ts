/**
 * Sanitized HTML with each image removed. For the cards of an auto-note plugin
 * that reads notes. Its sandbox has no network. Thus, what it returns is the
 * only way out for what it read, and the browser loads an image from the
 * address in it at the moment when it draws the card. A link stays. It goes
 * nowhere until the user follows it.
 *
 * Each `src` goes, not only that of an image. The sanitizer lets `input` and
 * `src` through, and `<input type="image" src>` loads as an image does.
 *
 * Parsed and serialized, not matched with a pattern. A pattern would let
 * through a tag written in an unexpected way. The content of a `template` is
 * inert. Thus, nothing loads while the images are still in it.
 */
const cache = new Map<string, string>();
const CACHE_SIZE = 500;

export function withoutImages(html: string): string {
  if (!html.includes("<img") && !html.includes("src=")) return html;
  const cached = cache.get(html);
  if (cached !== undefined) return cached;
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const image of template.content.querySelectorAll("img")) {
    // The name of the image stays, as text. Thus, the card is still readable.
    const alt = image.getAttribute("alt");
    image.replaceWith(alt ? document.createTextNode(alt) : "");
  }
  for (const fetching of template.content.querySelectorAll("[src]")) {
    fetching.remove();
  }
  const stripped = template.innerHTML;
  cache.set(html, stripped);
  if (cache.size > CACHE_SIZE) {
    cache.delete(cache.keys().next().value as string);
  }
  return stripped;
}
