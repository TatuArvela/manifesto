import DOMPurify from "dompurify";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

/**
 * What a rendered note is allowed to contain. Everything markdown produces,
 * plus the few tags our own toolbar writes as raw HTML.
 */
const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // Markdown standard
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "strong",
    "b",
    "em",
    "i",
    "del",
    "s",
    "blockquote",
    "pre",
    "code",
    "ul",
    "ol",
    "li",
    "a",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    // Formatting toolbar additions
    "u",
    "sub",
    "sup",
    // Inline spans for styling
    "span",
    // GFM task-list checkboxes (rendered by remark-gfm)
    "input",
  ],
  ALLOWED_ATTR: [
    "href",
    "target",
    "rel", // links
    "src",
    "alt",
    "title", // images
    "class", // styling
    "type",
    "checked",
    "disabled", // task-list checkboxes
  ],
};

/**
 * Every link in a rendered note opens in a new tab, so following one never
 * navigates away from the notes. `noopener` keeps the opened page from
 * reaching back into this one through `window.opener`.
 *
 * A hook rather than a pass over the output because it runs on exactly what
 * survived sanitizing, including an `<a>` written as raw HTML with a `target`
 * of its own. DOMPurify hooks are global, which is fine while this module is
 * DOMPurify's only user.
 */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A" || !node.hasAttribute("href")) return;
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
});

/**
 * `allowDangerousHtml` is what lets `<u>`, `<sub>` and `<sup>` survive.
 * Without it `remark-rehype` drops every raw HTML node before DOMPurify is
 * ever asked, so the three tags our own formatting toolbar writes vanished
 * from previews while sitting in the allowlist below, apparently permitted.
 *
 * The "dangerous" is real and it is `renderMarkdown`'s job to answer: raw HTML
 * now reaches the sanitizer, which is the boundary that was always meant to
 * decide this. Nothing outside `ALLOWED_TAGS` / `ALLOWED_ATTR` gets through.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify, { allowDangerousHtml: true });

/**
 * Markdown to HTML, sanitized. Every caller feeds the result to
 * `dangerouslySetInnerHTML`, and note content can arrive from a shared link,
 * an imported file or a plugin, so sanitizing is part of rendering rather
 * than something each call site remembers to do. One of the three used to
 * forget the allowlist, and nothing said so.
 */
export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(String(processor.processSync(md)), PURIFY_CONFIG);
}

/**
 * The same rendering for a fragment that has to sit inside a line, such as a
 * checklist item's label, which lives next to its checkbox. A single wrapping
 * paragraph is unwrapped; anything block-shaped keeps its markup, since a
 * label that really does contain a list is better ugly than swallowed.
 *
 * Checklist labels used to be printed as plain text, so `**milk**` in an item
 * showed its asterisks while the same text one line below, outside the list,
 * rendered bold.
 */
export function renderInlineMarkdown(md: string): string {
  const html = renderMarkdown(md).trim();
  const single = /^<p>([\s\S]*)<\/p>$/.exec(html);
  if (!single || single[1].includes("<p>")) return html;
  return single[1];
}
