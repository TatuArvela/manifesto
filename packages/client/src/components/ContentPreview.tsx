import type { Note } from "@manifesto/shared";
import { useId } from "preact/hooks";
import { parseChecklistLine, segmentContent } from "#/utils/markdown.ts";
import {
  renderInlineMarkdown,
  renderMarkdown,
} from "#/utils/remarkRenderer.ts";
import { withoutImages } from "#/utils/stripImages.ts";

/**
 * Renders note content as a read-only preview with interactive checkboxes. It
 * uses segmentContent to split the content into checklist and markdown blocks.
 */
export function ContentPreview({
  note,
  onCheckboxToggle,
  hasTitle,
  readOnly = false,
  noImages = false,
}: {
  /**
   * Only the text is read. Thus, an invitation can show the preview of a note
   * of which it has only the text.
   */
  note: Pick<Note, "content">;
  onCheckboxToggle: (lineIndex: number) => void;
  hasTitle: boolean;
  /**
   * Boxes that show their state, but cannot be ticked: a note shared with this
   * user only to view.
   */
  readOnly?: boolean;
  /**
   * Draws no images: the card of a plugin that reads notes. See
   * `withoutImages`.
   */
  noImages?: boolean;
}) {
  const id = useId();
  const drawn = (html: string) => (noImages ? withoutImages(html) : html);
  if (!note.content) return null;

  // Remove empty text segments between two checklist segments. They come from
  // the "spread" list serialization of mdast. If not, they show as a full-line
  // gap between items that belong together.
  const rawSegments = segmentContent(note.content);
  const segments = rawSegments.filter((seg, i) => {
    if (seg.type !== "text") return true;
    if (seg.lines.some((l) => l.trim() !== "")) return true;
    const prev = rawSegments[i - 1];
    const next = rawSegments[i + 1];
    return !(prev?.type === "checklist" && next?.type === "checklist");
  });

  // Count the empty lines at the start and end of each segment, for spacing.
  const hasLeadingBlank = (seg: (typeof segments)[number]) =>
    seg.lines[0]?.trim() === "";
  const hasTrailingBlank = (seg: (typeof segments)[number]) =>
    seg.lines.at(-1)?.trim() === "";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stops a link's click reaching the card
    // biome-ignore lint/a11y/useKeyWithClickEvents: a link handles its own keys
    <div
      class={`${hasTitle ? "mt-2" : ""} text-sm text-neutral-600 dark:text-neutral-300 line-clamp-12`}
      onClick={(e) => {
        // A link opens in a new tab (see `renderMarkdown`). If the card behind
        // it also opened its editor, the note would be in two places.
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
                // these items. Thus, these actions can change each box drawn
                // here.
                const item = parseChecklistLine(line);
                if (!item) return null;
                return (
                  <div
                    key={lineIndex}
                    class="inline-flex items-start gap-2"
                    style={{ paddingLeft: `${item.indent.length * 7.5}px` }}
                  >
                    {/* The box is drawn at 16px and pressed at 24px (WCAG
                        2.5.8): the label around it reaches 4px further on
                        each side, and its negative margin keeps the row as
                        it was. A press on it stops here, not at the card. */}
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keys are the input's own; this only keeps a press from the card */}
                    <label
                      class={`-mx-1 -mb-1 -mt-0.5 p-1 shrink-0 ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        class={`block w-4 h-4 rounded appearance-none border-2 border-neutral-500 dark:border-neutral-400 transition-colors checkbox-custom ${readOnly ? "cursor-default" : "cursor-pointer hover:border-neutral-600 dark:hover:border-neutral-300"}`}
                        checked={item.checked}
                        disabled={readOnly}
                        aria-labelledby={`${id}-${lineIndex}`}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => onCheckboxToggle(lineIndex)}
                      />
                    </label>
                    {/* The label is markdown like any other text: printed
                        raw, `**milk**` showed its asterisks while the same
                        words one line below rendered bold. */}
                    <span
                      id={`${id}-${lineIndex}`}
                      class={`note-inline-markdown ${item.checked ? "line-through" : ""}`}
                      dangerouslySetInnerHTML={{
                        __html: drawn(
                          renderInlineMarkdown(item.label, item.checked),
                        ),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          );
        }
        // Render a text block as markdown.
        const text = seg.lines.join("\n");
        if (!text.trim()) {
          // An empty text segment between checklists: render a spacer that is
          // the same as the empty <p><br></p> of the editor. Thus, the spacing
          // agrees.
          return (
            <div
              key={seg.startLine}
              aria-hidden="true"
              style={{ height: `${seg.lines.length * 1.25}em` }}
            />
          );
        }
        const html = drawn(renderMarkdown(text));
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
