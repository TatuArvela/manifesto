import type { Note } from "@manifesto/shared";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { segmentContent } from "../utils/markdown.js";

const marked = new Marked();

/** Only allow safe HTML elements and attributes in rendered markdown. */
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
  ],
  ALLOWED_ATTR: [
    "href",
    "target",
    "rel", // links
    "src",
    "alt",
    "title", // images
    "class", // styling
  ],
};

/**
 * Renders note content as a read-only preview with interactive checkboxes.
 * Reuses segmentContent to split into checklist and markdown blocks.
 */
export function ContentPreview({
  note,
  onCheckboxToggle,
  hasTitle,
}: {
  note: Note;
  onCheckboxToggle: (lineIndex: number) => void;
  hasTitle: boolean;
}) {
  if (!note.content) return null;

  const segments = segmentContent(note.content);

  // Count leading/trailing empty lines per segment for spacing
  const hasLeadingBlank = (seg: (typeof segments)[number]) =>
    seg.lines.length > 0 && seg.lines[0].trim() === "";
  const hasTrailingBlank = (seg: (typeof segments)[number]) =>
    seg.lines.length > 0 && seg.lines[seg.lines.length - 1].trim() === "";

  return (
    <div
      class={`${hasTitle ? "mt-2" : ""} text-sm text-gray-600 dark:text-gray-300 line-clamp-12`}
    >
      {segments.map((seg, segIdx) => {
        const prev = segIdx > 0 ? segments[segIdx - 1] : null;
        const gapAbove =
          segIdx > 0 &&
          prev &&
          (hasTrailingBlank(prev) || hasLeadingBlank(seg));

        if (seg.type === "checklist") {
          return (
            <div
              key={seg.startLine}
              class={`flex flex-col items-start space-y-1.5 ${gapAbove ? "mt-3" : segIdx > 0 ? "mt-1" : ""}`}
            >
              {seg.lines.map((line, j) => {
                const lineIndex = seg.startLine + j;
                const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
                const unchecked = line.match(/^\s*(?:- )?\[ \] (.*)$/);
                const checked = line.match(/^\s*(?:- )?\[x\] (.*)$/i);
                if (unchecked) {
                  return (
                    <div
                      key={lineIndex}
                      class="inline-flex items-start gap-2"
                      style={{ paddingLeft: `${indent * 7.5}px` }}
                    >
                      <input
                        type="checkbox"
                        class="mt-0.5 w-4 h-4 rounded appearance-none border-2 border-gray-500 dark:border-gray-400 shrink-0 cursor-pointer hover:border-gray-600 dark:hover:border-gray-300 transition-colors checkbox-custom"
                        checked={false}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onCheckboxToggle(lineIndex)}
                      />
                      <span>{unchecked[1]}</span>
                    </div>
                  );
                }
                if (checked) {
                  return (
                    <div
                      key={lineIndex}
                      class="inline-flex items-start gap-2"
                      style={{ paddingLeft: `${indent * 7.5}px` }}
                    >
                      <input
                        type="checkbox"
                        class="mt-0.5 w-4 h-4 rounded appearance-none border-2 border-gray-500 dark:border-gray-400 shrink-0 cursor-pointer hover:border-gray-600 dark:hover:border-gray-300 transition-colors checkbox-custom"
                        checked={true}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onCheckboxToggle(lineIndex)}
                      />
                      <span class="line-through opacity-60">{checked[1]}</span>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          );
        }
        // Render text block as markdown
        const text = seg.lines.join("\n");
        if (!text.trim()) {
          // Empty text segment between checklists — render a spacer that
          // mirrors the editor's empty <p><br></p> so spacing matches.
          return (
            <div
              key={seg.startLine}
              aria-hidden="true"
              style={{ height: `${seg.lines.length * 1.25}em` }}
            />
          );
        }
        const html = DOMPurify.sanitize(
          marked.parse(text, { breaks: true }) as string,
          PURIFY_CONFIG,
        ) as string;
        return (
          <div
            key={seg.startLine}
            class={`prose prose-sm dark:prose-invert max-w-none ${gapAbove ? "mt-3" : segIdx > 0 ? "mt-1" : ""}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
