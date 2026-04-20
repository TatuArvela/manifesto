/**
 * Cross-pipeline conformance tests.
 *
 * Manifesto has three markdown pipelines:
 *  1. Markdown → Tiptap editor DOM (`tiptap-markdown` + custom extensions)
 *  2. Tiptap editor → Markdown   (`tiptap-markdown` serializer)
 *  3. Markdown → `<ContentPreview>` DOM (`segmentContent` + `marked`)
 *
 * These tests reduce (1) and (3) to a canonical AST and assert they agree.
 * They also assert (1) → (2) round-trip idempotence. Known divergences live
 * in the corpus as `skipCrossPipeline` with a reason — the file itself acts
 * as the catalog of what each pipeline does.
 */

import type { Note } from "@manifesto/shared";
import { NoteColor, NoteFont } from "@manifesto/shared";
import { cleanup, render } from "@testing-library/preact";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { ContentPreview } from "./ContentPreview.js";
import { getMarkdown, tiptapExtensions } from "./TiptapEditor.js";

// ---------- Canonical AST ----------

type Inline = string;

type Block =
  | { kind: "heading"; level: number; text: Inline }
  | { kind: "paragraph"; text: Inline }
  | { kind: "blockquote"; blocks: Block[] }
  | { kind: "bulletList"; items: Block[][] }
  | { kind: "orderedList"; items: Block[][] }
  | { kind: "taskList"; items: { checked: boolean; blocks: Block[] }[] }
  | { kind: "codeBlock"; text: string }
  | { kind: "hr" };

// ---------- Inline serialization ----------

function inlineOf(el: Element | Node): string {
  if (el.nodeType === Node.TEXT_NODE) return (el as Text).data;
  if (!(el instanceof Element)) return "";
  const kids = () =>
    Array.from(el.childNodes)
      .map((c) => inlineOf(c))
      .join("");
  switch (el.tagName) {
    case "STRONG":
    case "B":
      return `**${kids()}**`;
    case "EM":
    case "I":
      return `*${kids()}*`;
    case "DEL":
    case "S":
      return `~~${kids()}~~`;
    case "CODE":
      return `\`${kids()}\``;
    case "U":
      return `<u>${kids()}</u>`;
    case "SUB":
      return `<sub>${kids()}</sub>`;
    case "SUP":
      return `<sup>${kids()}</sup>`;
    case "A":
      return `[${kids()}](${el.getAttribute("href") ?? ""})`;
    case "BR":
      if (el.classList.contains("ProseMirror-trailingBreak")) return "";
      return "\n";
    default:
      return kids();
  }
}

function normInline(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function textOf(el: Element): string {
  return normInline(inlineOf(el));
}

// ---------- Block walkers ----------

function isEditorTaskList(el: Element): boolean {
  return (
    el.tagName === "UL" &&
    (el.getAttribute("data-type") === "taskList" ||
      el.classList.contains("contains-task-list"))
  );
}

function isPreviewTaskList(el: Element): boolean {
  // ContentPreview's checklist segment: <div class="flex flex-col ..."> with
  // children <div class="inline-flex ..."><input type="checkbox"><span/></div>
  if (el.tagName !== "DIV") return false;
  if (!el.classList.contains("flex")) return false;
  const first = el.firstElementChild;
  return !!first?.querySelector(":scope > input[type='checkbox']");
}

function childBlocks(parent: Element): Block[] {
  const out: Block[] = [];
  for (const child of Array.from(parent.children)) {
    const r = blockOf(child);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  return out;
}

function blockOf(el: Element): Block | Block[] | null {
  if (el.tagName === "BR") return null;

  if (isEditorTaskList(el)) return taskListFromEditor(el);
  if (isPreviewTaskList(el)) return taskListFromPreview(el);

  if (/^H[1-6]$/.test(el.tagName)) {
    return {
      kind: "heading",
      level: Number(el.tagName[1]),
      text: textOf(el),
    };
  }
  if (el.tagName === "P") {
    const text = textOf(el);
    if (text === "") return null;
    return { kind: "paragraph", text };
  }
  if (el.tagName === "BLOCKQUOTE") {
    return { kind: "blockquote", blocks: childBlocks(el) };
  }
  if (el.tagName === "UL") {
    const items = Array.from(el.children)
      .filter((c) => c.tagName === "LI")
      .map((li) => listItemBlocks(li));
    return { kind: "bulletList", items };
  }
  if (el.tagName === "OL") {
    const items = Array.from(el.children)
      .filter((c) => c.tagName === "LI")
      .map((li) => listItemBlocks(li));
    return { kind: "orderedList", items };
  }
  if (el.tagName === "PRE") {
    const code = el.querySelector("code");
    return {
      kind: "codeBlock",
      text: code?.textContent ?? el.textContent ?? "",
    };
  }
  if (el.tagName === "HR") return { kind: "hr" };

  // Unknown wrapper — descend.
  if (el.children.length > 0) return childBlocks(el);
  return null;
}

function listItemBlocks(li: Element): Block[] {
  // A tight list item in marked renders text directly in <li>; a loose one
  // wraps in <p>. Both cases work: childBlocks picks up <p>, and if there's
  // nothing structural inside we synthesize a paragraph from the text.
  const blocks = childBlocks(li);
  if (blocks.length === 0) {
    const text = textOf(li);
    if (text) blocks.push({ kind: "paragraph", text });
  }
  // Some children are inline text nodes the editor DOM exposes between block
  // children (e.g. loose bullets). If the li has inline text siblings AND no
  // <p>, promote it here. We detect this by comparing textContent vs blocks.
  return blocks;
}

function taskListFromEditor(ul: Element): Block {
  const items: { checked: boolean; blocks: Block[] }[] = [];
  for (const li of Array.from(ul.children)) {
    if (li.tagName !== "LI") continue;
    const cb = li.querySelector<HTMLInputElement>(
      ":scope > label > input[type='checkbox']",
    );
    const checked = cb?.checked ?? li.getAttribute("data-checked") === "true";
    // Editor node view: <div handle><label/><div class="task-item-content">…</div>
    // Default task-item render (if not using the draggable view): <label/><div>…</div>
    const content =
      li.querySelector<HTMLElement>(":scope > .task-item-content") ??
      li.querySelector<HTMLElement>(":scope > div:not(.task-item-drag-handle)");
    const blocks = content ? childBlocks(content) : [];
    items.push({ checked, blocks });
  }
  return { kind: "taskList", items };
}

function taskListFromPreview(container: Element): Block {
  const items: { checked: boolean; blocks: Block[] }[] = [];
  for (const row of Array.from(container.children)) {
    const cb = row.querySelector<HTMLInputElement>(
      ":scope > input[type='checkbox']",
    );
    if (!cb) continue;
    const span = row.querySelector<HTMLElement>(":scope > span");
    const text = normInline(span ? inlineOf(span) : "");
    items.push({
      checked: cb.checked,
      blocks: text === "" ? [] : [{ kind: "paragraph", text }],
    });
  }
  return { kind: "taskList", items };
}

// ---------- Pipeline entry points ----------

function roundTrip(markdown: string): string {
  const el = document.createElement("div");
  const editor = new Editor({
    element: el,
    extensions: tiptapExtensions,
    content: markdown,
  });
  const out = getMarkdown(editor);
  editor.destroy();
  return out;
}

function editorBlocks(markdown: string): Block[] {
  const el = document.createElement("div");
  const editor = new Editor({
    element: el,
    extensions: tiptapExtensions,
    content: markdown,
  });
  const pm = el.querySelector(".ProseMirror") ?? el;
  const blocks = childBlocks(pm);
  editor.destroy();
  return blocks;
}

function makeNote(content: string): Note {
  return {
    id: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    title: "",
    content,
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function previewBlocks(markdown: string): Block[] {
  const { container } = render(
    <ContentPreview
      note={makeNote(markdown)}
      onCheckboxToggle={() => {}}
      hasTitle={false}
    />,
  );
  const root = container.firstElementChild;
  return root ? childBlocks(root) : [];
}

// ---------- Corpus ----------

interface CorpusEntry {
  name: string;
  markdown: string;
  /** Expected round-trip output, if different from the input. */
  roundTripTo?: string;
  /** Skip the cross-pipeline assertion with a documented reason. */
  skipCrossPipeline?: string;
}

const corpus: CorpusEntry[] = [
  { name: "plain text", markdown: "Hello world" },
  { name: "bold", markdown: "**bold**" },
  { name: "italic", markdown: "*italic*" },
  { name: "strike", markdown: "~~struck~~" },
  { name: "inline code", markdown: "`code`" },
  { name: "link", markdown: "[link](https://example.com)" },
  { name: "underline", markdown: "<u>underlined</u>" },
  { name: "subscript", markdown: "<sub>sub</sub>" },
  { name: "superscript", markdown: "<sup>sup</sup>" },
  { name: "heading 1", markdown: "# Heading 1" },
  { name: "heading 2", markdown: "## Heading 2" },
  { name: "heading 3", markdown: "### Heading 3" },
  { name: "heading 4", markdown: "#### Heading 4" },
  { name: "blockquote", markdown: "> quoted text" },
  { name: "unordered list", markdown: "- one\n- two\n- three" },
  { name: "ordered list", markdown: "1. first\n2. second\n3. third" },
  {
    name: "task list (tight)",
    markdown: "- [ ] unchecked\n- [x] checked",
  },
  {
    name: "task list with blank-line split",
    markdown: "- [ ] a\n\n- [ ] b",
  },
  {
    name: "empty task item then content",
    markdown: "- [ ] \n- [ ] Tes",
  },
  {
    name: "standalone empty task item",
    markdown: "- [ ] ",
  },
  {
    name: "empty task item without trailing space",
    markdown: "- [ ]\n- [ ] Tes",
    roundTripTo: "- [ ] \n- [ ] Tes",
    skipCrossPipeline:
      "preview's segmentContent regex requires a trailing space on the marker, so `- [ ]` without it falls through to marked as a literal bullet",
  },
  {
    name: "nested task list",
    markdown: "- [ ] parent\n\n  - [x] child\n  - [ ] child 2\n\n- [x] sibling",
    // The editor collapses the blank line between a parent task and its
    // nested children (nesting is implicit, not separated by paragraphs).
    roundTripTo:
      "- [ ] parent\n  - [x] child\n  - [ ] child 2\n\n- [x] sibling",
    skipCrossPipeline:
      "ContentPreview renders nested checklist lines as flat siblings with padding-left, whereas the editor preserves nesting as a tree",
  },
  {
    name: "mixed content",
    markdown: [
      "# Title",
      "",
      "Some **bold** and *italic* text.",
      "",
      "- [ ] task one",
      "- [x] task two",
      "",
      "> a quote",
    ].join("\n"),
  },
];

// ---------- Tests ----------

afterEach(() => cleanup());

describe("markdown conformance", () => {
  for (const entry of corpus) {
    describe(entry.name, () => {
      it("round-trip is idempotent", () => {
        const once = roundTrip(entry.markdown);
        const target = entry.roundTripTo ?? entry.markdown;
        expect(once).toBe(target);
        expect(roundTrip(once)).toBe(target);
      });

      if (entry.skipCrossPipeline) {
        // Known divergence — assert inequality so the skip reason stays
        // honest. If a future fix aligns the pipelines, this flips and the
        // corpus entry should drop `skipCrossPipeline`.
        it(`editor and preview DIVERGE (${entry.skipCrossPipeline})`, () => {
          const ed = editorBlocks(entry.markdown);
          const pv = previewBlocks(entry.markdown);
          expect(pv).not.toEqual(ed);
        });
      } else {
        it("editor and preview produce the same canonical shape", () => {
          const ed = editorBlocks(entry.markdown);
          const pv = previewBlocks(entry.markdown);
          expect(pv).toEqual(ed);
        });
      }
    });
  }
});
