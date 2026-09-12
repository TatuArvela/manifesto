import type { Note } from "@manifesto/shared";
import { parseChecklistLine, segmentContent } from "../utils/markdown.js";
import {
  renderInlineMarkdown,
  renderMarkdown,
} from "../utils/remarkRenderer.js";

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

  // Drop empty text segments sandwiched between two checklist segments:
  // they come from mdast's "spread" list serialization and would otherwise
  // render as a full-line gap between items that visually belong together.
  const rawSegments = segmentContent(note.content);
  const segments = rawSegments.filter((seg, i) => {
    if (seg.type !== "text") return true;
    if (seg.lines.some((l) => l.trim() !== "")) return true;
    const prev = rawSegments[i - 1];
    const next = rawSegments[i + 1];
    return !(prev?.type === "checklist" && next?.type === "checklist");
  });

  // Count leading/trailing empty lines per segment for spacing
  const hasLeadingBlank = (seg: (typeof segments)[number]) =>
    seg.lines.length > 0 && seg.lines[0].trim() === "";
  const hasTrailingBlank = (seg: (typeof segments)[number]) =>
    seg.lines.length > 0 && seg.lines[seg.lines.length - 1].trim() === "";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stops a link's click reaching the card
    // biome-ignore lint/a11y/useKeyWithClickEvents: a link handles its own keys
    <div
      class={`${hasTitle ? "mt-2" : ""} text-sm text-neutral-600 dark:text-neutral-300 line-clamp-12`}
      onClick={(e) => {
        // A link opens in a new tab (see `renderMarkdown`); the card behind
        // it opening its editor as well would leave the note in two places.
        if ((e.target as Element).closest("a")) e.stopPropagation();
      }}
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
              class={`flex flex-col items-start space-y-2 ${gapAbove ? "mt-3" : segIdx > 0 ? "mt-1" : ""}`}
            >
              {seg.lines.map((line, j) => {
                const lineIndex = seg.startLine + j;
                // One parser, shared with the actions that toggle and delete
                // these items. Two patterns used to disagree about what a
                // checklist line is, so the preview could draw a box for a
                // line `toggleCheckbox` then refused to touch.
                const item = parseChecklistLine(line);
                if (!item) return null;
                return (
                  <div
                    key={lineIndex}
                    class="inline-flex items-start gap-2"
                    style={{ paddingLeft: `${item.indent.length * 7.5}px` }}
                  >
                    <input
                      type="checkbox"
                      class="mt-0.5 w-4 h-4 rounded appearance-none border-2 border-neutral-500 dark:border-neutral-400 shrink-0 cursor-pointer hover:border-neutral-600 dark:hover:border-neutral-300 transition-colors checkbox-custom"
                      checked={item.checked}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onCheckboxToggle(lineIndex)}
                    />
                    {/* The label is markdown like any other text: printed
                        raw, `**milk**` showed its asterisks while the same
                        words one line below rendered bold. */}
                    <span
                      class={`note-inline-markdown ${item.checked ? "line-through opacity-60" : ""}`}
                      dangerouslySetInnerHTML={{
                        __html: renderInlineMarkdown(item.label),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        }
        // Render text block as markdown
        const text = seg.lines.join("\n");
        if (!text.trim()) {
          // Empty text segment between checklists: render a spacer that
          // mirrors the editor's empty <p><br></p> so spacing matches.
          return (
            <div
              key={seg.startLine}
              aria-hidden="true"
              style={{ height: `${seg.lines.length * 1.25}em` }}
            />
          );
        }
        const html = renderMarkdown(text);
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
