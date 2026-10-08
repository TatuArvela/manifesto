/**
 * Sanitized HTML with every image taken out. For the cards of an auto-note
 * plugin that reads notes: its sandbox has no network, so what it returns is
 * the only way anything it read could leave, and an image is fetched from
 * wherever its address says the moment the card is drawn. A link is left in:
 * it goes nowhere until the user follows it.
 *
 * Every `src` goes, not only an image's: the sanitizer lets `input` and
 * `src` through, and `<input type="image" src>` fetches as an image does.
 *
 * Parsed and serialized rather than matched with a pattern, which is how a
 * tag written in some unexpected way would get through. A `template`'s
 * content is inert, so nothing loads while the images are still in it.
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
    // What the image was called stays, as text, so the card still reads.
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
