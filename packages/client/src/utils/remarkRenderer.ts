import DOMPurify from "dompurify";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { findItemDate, itemDateClass, localIsoDate } from "./itemDate.ts";

/**
 * What a rendered note can contain. All that Markdown makes, plus the few tags
 * that our own toolbar writes as raw HTML.
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
    "class", // the pipeline's own, see `RENDERED_CLASSES`
    "type",
    "checked",
    "disabled", // task-list checkboxes
    "align", // table cells
  ],
};

/**
 * Each link in a rendered note opens in a new tab. Thus, a link never navigates
 * away from the notes. `noopener` prevents the opened page from access to this
 * page through `window.opener`.
 *
 * A hook, not a pass over the output, because it runs on exactly what stayed
 * after the sanitizer, also an `<a>` written as raw HTML with its own `target`.
 * DOMPurify hooks are global, which is acceptable while this module is the only
 * user of DOMPurify.
 */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A" || !node.hasAttribute("href")) return;
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer");
});

/**
 * The classes that a rendered note can have: those that the pipeline itself
 * writes (the task lists and code languages of GFM, the footnote label, the
 * date chip). The code drops all others. A note can come from a different
 * person (a share, a public link, a plugin). The own utility classes of the
 * page would let it put itself over the app (`fixed inset-0 z-50`) as a fake
 * sign-in, or as a link that looks like a button.
 */
const RENDERED_CLASSES = new Set([
  "contains-task-list",
  "task-list-item",
  "item-date",
  "item-date-overdue",
  "sr-only",
]);
const CODE_LANGUAGE_CLASS = /^language-[\w+#.-]{1,40}$/;

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (data.attrName !== "class") return;
  const kept = data.attrValue
    .split(/\s+/)
    .filter(
      (name) => RENDERED_CLASSES.has(name) || CODE_LANGUAGE_CLASS.test(name),
    );
  if (kept.length === 0) data.keepAttr = false;
  else data.attrValue = kept.join(" ");
});

/**
 * What is rendered, which decides where a date token becomes a chip (see
 * `itemDate.ts`). In a full document, only inside a task list item. In the
 * label of a checklist item, anywhere, because the caller already removed the
 * box from it, and tells here if it was ticked.
 */
type RenderMode = "document" | "openItem" | "doneItem";

/** As much of a hast node as the chip pass reads and writes. */
interface HtmlNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
}

/**
 * The item to which a text node belongs. Null where a token stays plain text.
 */
type ItemContext = { checked: boolean; dated: boolean } | null;

function isTicked(item: HtmlNode): boolean {
  // The box is the first child of the item, or the first child of its paragraph
  // when the list is spread.
  const [first] = item.children ?? [];
  const box = first?.tagName === "p" ? first.children?.[0] : first;
  return box?.tagName === "input" && box.properties?.checked === true;
}

function chipDates(node: HtmlNode, item: ItemContext, today: string): void {
  const children = node.children;
  if (!children) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    if (child.type === "text") {
      // One chip for each item. A second date in the same text is only text.
      const found =
        item && !item.dated ? findItemDate(child.value ?? "") : null;
      if (!item || !found) continue;
      item.dated = true;
      const text = child.value ?? "";
      children.splice(
        i,
        1,
        { type: "text", value: text.slice(0, found.start) },
        {
          type: "element",
          tagName: "span",
          properties: {
            className: itemDateClass(found.date, item.checked, today),
          },
          children: [
            { type: "text", value: text.slice(found.start, found.end) },
          ],
        },
        { type: "text", value: text.slice(found.end) },
      );
      i += 2;
      continue;
    }
    if (child.tagName === "code" || child.tagName === "pre") continue;
    if (child.tagName === "li") {
      const classes = child.properties?.className;
      const isTask =
        Array.isArray(classes) && classes.includes("task-list-item");
      chipDates(
        child,
        isTask ? { checked: isTicked(child), dated: false } : null,
        today,
      );
      continue;
    }
    chipDates(child, item, today);
  }
}

function itemDateChips(mode: RenderMode) {
  return () => (tree: HtmlNode) => {
    chipDates(
      tree,
      mode === "document"
        ? null
        : { checked: mode === "doneItem", dated: false },
      localIsoDate(new Date()),
    );
  };
}

/**
 * `allowDangerousHtml` lets `<u>`, `<sub>` and `<sup>` stay. Without it,
 * `remark-rehype` drops each raw HTML node before DOMPurify gets it. Thus, the
 * three tags that our own formatting toolbar writes disappeared from previews,
 * while they were in the allowlist below and looked permitted.
 *
 * The "dangerous" is real, and `renderMarkdown` must answer it. Raw HTML now
 * reaches the sanitizer, which is the boundary that was always intended to
 * decide this. Nothing outside `ALLOWED_TAGS` / `ALLOWED_ATTR` gets through.
 */
function makeProcessor(mode: RenderMode) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkBreaks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(itemDateChips(mode))
    .use(rehypeStringify, { allowDangerousHtml: true });
}

const processors = {
  document: makeProcessor("document"),
  openItem: makeProcessor("openItem"),
  doneItem: makeProcessor("doneItem"),
};

/**
 * Rendered HTML by source, most recently used last.
 *
 * Each card on the board renders its preview through here, and a card renders
 * again for reasons that are not related to its text: the editor opens, a
 * selection, a drag over it. The pipeline costs most of a millisecond for each
 * block before DOMPurify. Thus, a board of a hundred cards used a hundred
 * milliseconds or more to make the HTML that it already had. Sufficiently big
 * for each block of a large board. A `Map` keeps the insertion order. Thus, the
 * first key is the key to remove.
 */
const RENDER_CACHE_SIZE = 2000;
const renderCache = new Map<string, string>();

/**
 * Markdown to HTML, sanitized. Each caller gives the result to
 * `dangerouslySetInnerHTML`, and note content can come from a shared link, an
 * imported file or a plugin. Thus, the sanitizer is part of the render, not a
 * step that each call site must remember. Before, one of the three forgot the
 * allowlist, and nothing told this.
 */
export function renderMarkdown(md: string): string {
  return render(md, "document");
}

function render(md: string, mode: RenderMode): string {
  // Only text that could contain a date token depends on the mode and on the
  // day. A chip becomes overdue at midnight with no change to its source.
  const key = md.includes("@")
    ? `${mode} ${localIsoDate(new Date())}\n${md}`
    : md;
  const cached = renderCache.get(key);
  if (cached !== undefined) {
    renderCache.delete(key);
    renderCache.set(key, cached);
    return cached;
  }
  const html = DOMPurify.sanitize(
    String(processors[mode].processSync(md)),
    PURIFY_CONFIG,
  );
  renderCache.set(key, html);
  if (renderCache.size > RENDER_CACHE_SIZE) {
    renderCache.delete(renderCache.keys().next().value as string);
  }
  return html;
}

/**
 * The same render for a fragment that must be inside a line, for example the
 * label of a checklist item, which is next to its checkbox. A single wrapping
 * paragraph is unwrapped. All block content keeps its markup, because an ugly
 * label that really contains a list is better than lost content.
 *
 * Checklist labels go through this. Thus, `**milk**` in an item renders bold,
 * as the same text does outside the list. `checked` tells that the fragment is
 * such a label, and if its box is ticked. Thus, a date in it is drawn as a
 * chip.
 */
export function renderInlineMarkdown(md: string, checked?: boolean): string {
  const html = render(
    md,
    checked === undefined ? "document" : checked ? "doneItem" : "openItem",
  ).trim();
  const inner = /^<p>([\s\S]*)<\/p>$/.exec(html)?.[1];
  if (inner === undefined || inner.includes("<p>")) return html;
  return inner;
}
