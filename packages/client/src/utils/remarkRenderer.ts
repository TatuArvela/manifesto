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

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkBreaks)
  .use(remarkRehype)
  .use(rehypeStringify);

/**
 * Markdown to HTML, sanitized. Every caller feeds the result to
 * `dangerouslySetInnerHTML`, and note content can arrive from a shared link,
 * an imported file or a plugin, so sanitizing is part of rendering rather
 * than something each call site remembers to do — one of the three used to
 * forget the allowlist, and nothing said so.
 */
export function renderMarkdown(md: string): string {
  return DOMPurify.sanitize(String(processor.processSync(md)), PURIFY_CONFIG);
}
