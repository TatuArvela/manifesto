import type { Ref } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import {
  ChecklistEditor,
  type ChecklistEditorHandle,
  isChecklistLine,
} from "./ChecklistEditor.js";

export interface SegmentedContentEditorHandle {
  focusFirst: () => void;
}

export interface ContentSegment {
  type: "text" | "checklist";
  startLine: number;
  lines: string[];
}

export function segmentContent(content: string): ContentSegment[] {
  const lines = content.split("\n");
  const segments: ContentSegment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const type = isChecklistLine(lines[i]) ? "checklist" : "text";
    const last = segments[segments.length - 1];
    if (last && last.type === type) {
      last.lines.push(lines[i]);
    } else {
      segments.push({ type, startLine: i, lines: [lines[i]] });
    }
  }

  return segments;
}

function handleTabKey(e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const el = e.target as HTMLTextAreaElement;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const val = el.value;
  const lineStart = val.lastIndexOf("\n", start - 1) + 1;

  if (e.shiftKey) {
    const spaces = val.slice(lineStart).match(/^ {1,2}/);
    if (spaces) {
      const removed = spaces[0].length;
      el.value = val.slice(0, lineStart) + val.slice(lineStart + removed);
      el.selectionStart = Math.max(lineStart, start - removed);
      el.selectionEnd = Math.max(lineStart, end - removed);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } else {
    el.value = `${val.slice(0, lineStart)}  ${val.slice(lineStart)}`;
    el.selectionStart = start + 2;
    el.selectionEnd = end + 2;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

export function SegmentedContentEditor({
  content,
  onChange,
  disabled,
  contentLocked,
  rawMode,
  autoFocus,
  editorRef,
  onNavigateUp,
}: {
  content: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  contentLocked?: boolean;
  rawMode?: boolean;
  autoFocus?: boolean;
  editorRef?: Ref<SegmentedContentEditorHandle>;
  onNavigateUp?: () => void;
}) {
  const textareaRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const checklistRefs = useRef<Record<number, ChecklistEditorHandle | null>>(
    {},
  );
  const [pendingFocus, setPendingFocus] = useState<{
    segIndex: number;
    position: "first" | "last";
  } | null>(null);

  // Cross-segment drag tracking
  const crossDragRef = useRef<{
    segStartLine: number;
    lineIndex: number;
    dropped: boolean;
  } | null>(null);

  // Expose focus methods
  useImperativeHandle(editorRef ?? null, () => ({
    focusFirst: () => {
      const segments = segmentContent(content);
      if (segments.length === 0) {
        textareaRefs.current[-1]?.focus();
        return;
      }
      const first = segments[0];
      if (first.type === "checklist") {
        checklistRefs.current[first.startLine]?.focusFirst();
      } else {
        const el =
          textareaRefs.current[first.startLine] ?? textareaRefs.current[-1];
        if (el) {
          el.focus();
          el.selectionStart = 0;
          el.selectionEnd = 0;
        }
      }
    },
  }));

  // Handle pending focus after re-segmentation
  useEffect(() => {
    if (pendingFocus === null) return;
    const segments = segmentContent(content);
    const seg = segments[pendingFocus.segIndex];
    if (!seg) {
      setPendingFocus(null);
      return;
    }
    if (seg.type === "text") {
      const el = textareaRefs.current[seg.startLine];
      if (el) {
        el.focus();
        if (pendingFocus.position === "last") {
          el.selectionStart = el.value.length;
          el.selectionEnd = el.value.length;
        } else {
          el.selectionStart = 0;
          el.selectionEnd = 0;
        }
      }
    } else {
      const handle = checklistRefs.current[seg.startLine];
      if (handle) {
        if (pendingFocus.position === "last") {
          handle.focusLast();
        } else {
          handle.focusFirst();
        }
      }
    }
    setPendingFocus(null);
  }, [pendingFocus, content]);

  // Focus first editable area on mount or when content becomes empty
  const didAutoFocus = useRef(false);
  const prevHadContent = useRef(content.length > 0);
  useEffect(() => {
    const hasContent = content.length > 0;
    // Reset when content is cleared so the placeholder textarea gets focused
    if (prevHadContent.current && !hasContent) {
      didAutoFocus.current = false;
    }
    prevHadContent.current = hasContent;

    if (!autoFocus || didAutoFocus.current) return;
    for (const el of Object.values(textareaRefs.current)) {
      if (el) {
        el.focus();
        el.selectionStart = 0;
        el.selectionEnd = 0;
        didAutoFocus.current = true;
        break;
      }
    }
  });

  // Raw mode: single textarea
  if (rawMode) {
    const lineCount = content.split("\n").length;
    return (
      <div class="overflow-auto min-h-[80px] max-h-[50vh]">
        <textarea
          class="w-full bg-transparent outline-none text-sm font-mono"
          placeholder="Take a note..."
          value={content}
          onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            const el = e.target as HTMLTextAreaElement;
            if (e.key === "ArrowUp" && el.selectionStart === 0) {
              e.preventDefault();
              onNavigateUp?.();
              return;
            }
            handleTabKey(e);
          }}
          disabled={disabled}
          rows={lineCount}
          style={{ resize: "none" }}
          // biome-ignore lint/a11y/noAutofocus: editor should focus content
          autoFocus
        />
      </div>
    );
  }

  const segments = segmentContent(content);
  const allLines = content.split("\n");

  const updateSegmentLines = (seg: ContentSegment, newSegLines: string[]) => {
    const newAllLines = [...allLines];
    newAllLines.splice(seg.startLine, seg.lines.length, ...newSegLines);
    onChange(newAllLines.join("\n"));
  };

  const updateTextSegment = (seg: ContentSegment, newText: string) => {
    const newSegLines = newText.split("\n");
    updateSegmentLines(seg, newSegLines);
  };

  const focusPrevSegment = (segIdx: number) => {
    if (segIdx <= 0) {
      onNavigateUp?.();
      return;
    }
    const prev = segments[segIdx - 1];
    if (prev.type === "checklist") {
      checklistRefs.current[prev.startLine]?.focusLast();
    } else {
      const el = textareaRefs.current[prev.startLine];
      if (el) {
        el.focus();
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      }
    }
  };

  const focusNextSegment = (segIdx: number) => {
    if (segIdx >= segments.length - 1) return;
    const next = segments[segIdx + 1];
    if (next.type === "checklist") {
      checklistRefs.current[next.startLine]?.focusFirst();
    } else {
      const el = textareaRefs.current[next.startLine];
      if (el) {
        el.focus();
        el.selectionStart = 0;
        el.selectionEnd = 0;
      }
    }
  };

  const hasContent = content.length > 0;

  return (
    <div class="overflow-auto min-h-[80px] max-h-[50vh]">
      {hasContent &&
        segments.map((seg, segIdx) => {
          if (seg.type === "checklist") {
            return (
              <ChecklistEditor
                key={`cl-${seg.startLine}`}
                lines={seg.lines}
                onChange={(newLines) => {
                  const hadEmpty = newLines.some((l) => !isChecklistLine(l));
                  updateSegmentLines(seg, newLines);
                  if (hadEmpty) {
                    const emptyIdx = newLines.findIndex(
                      (l) => !isChecklistLine(l),
                    );
                    const absEmptyLine = seg.startLine + emptyIdx;
                    const newAllLines = [...allLines];
                    newAllLines.splice(
                      seg.startLine,
                      seg.lines.length,
                      ...newLines,
                    );
                    const newSegments = segmentContent(newAllLines.join("\n"));
                    const textSegIdx = newSegments.findIndex(
                      (s) =>
                        s.type === "text" &&
                        absEmptyLine >= s.startLine &&
                        absEmptyLine < s.startLine + s.lines.length,
                    );
                    if (textSegIdx !== -1) {
                      setPendingFocus({
                        segIndex: textSegIdx,
                        position: "last",
                      });
                    }
                  }
                }}
                disabled={disabled}
                checkboxOnly={contentLocked}
                editorRef={(ref) => {
                  checklistRefs.current[seg.startLine] = ref;
                }}
                onNavigateUp={() => focusPrevSegment(segIdx)}
                onNavigateDown={() => focusNextSegment(segIdx)}
                onItemDragStart={(lineIndex) => {
                  crossDragRef.current = {
                    segStartLine: seg.startLine,
                    lineIndex,
                    dropped: false,
                  };
                }}
                onItemDropExternal={(targetIndex) => {
                  const source = crossDragRef.current;
                  if (!source || source.segStartLine === seg.startLine) return;
                  const newAllLines = [...allLines];
                  // Remove from source segment
                  const sourceAbsLine = source.segStartLine + source.lineIndex;
                  const [movedLine] = newAllLines.splice(sourceAbsLine, 1);
                  // Compute target absolute line, adjusting if source was before target
                  let targetAbsLine = seg.startLine + targetIndex;
                  if (sourceAbsLine < targetAbsLine) {
                    targetAbsLine--;
                  }
                  newAllLines.splice(targetAbsLine, 0, movedLine);
                  source.dropped = true;
                  onChange(newAllLines.join("\n"));
                }}
                wasDroppedExternally={() =>
                  crossDragRef.current?.dropped ?? false
                }
              />
            );
          }
          const text = seg.lines.join("\n");
          const lineCount = seg.lines.length;
          return (
            <textarea
              key={`tx-${seg.startLine}`}
              ref={(el) => {
                textareaRefs.current[seg.startLine] = el;
              }}
              class="w-full bg-transparent outline-none text-sm block"
              placeholder={!hasContent ? "Take a note..." : undefined}
              value={text}
              onInput={(e) => {
                const newText = (e.target as HTMLTextAreaElement).value;
                const newSegLines = newText.split("\n");
                const hasChecklist = newSegLines.some((l) =>
                  isChecklistLine(l),
                );
                updateTextSegment(seg, newText);
                if (hasChecklist) {
                  // Content became a checklist — focus the new checklist segment
                  const newAllLines = [...allLines];
                  newAllLines.splice(
                    seg.startLine,
                    seg.lines.length,
                    ...newSegLines,
                  );
                  const newSegments = segmentContent(newAllLines.join("\n"));
                  // Find the absolute line of the first new checklist line
                  const firstCheckRelIdx = newSegLines.findIndex((l) =>
                    isChecklistLine(l),
                  );
                  const absLine = seg.startLine + firstCheckRelIdx;
                  // Find the segment containing that line (handles merges both up and down)
                  const clSegIdx = newSegments.findIndex(
                    (s) =>
                      s.type === "checklist" &&
                      absLine >= s.startLine &&
                      absLine < s.startLine + s.lines.length,
                  );
                  if (clSegIdx !== -1) {
                    const clSeg = newSegments[clSegIdx];
                    const lineInSeg = absLine - clSeg.startLine;
                    setPendingFocus({
                      segIndex: clSegIdx,
                      position: lineInSeg === 0 ? "first" : "last",
                    });
                  }
                }
              }}
              onKeyDown={(e) => {
                if (
                  e.key === "Backspace" &&
                  text === "" &&
                  segments.length > 1
                ) {
                  e.preventDefault();
                  const newAllLines = [...allLines];
                  newAllLines.splice(seg.startLine, seg.lines.length);
                  onChange(newAllLines.join("\n"));
                  const targetIdx = segIdx > 0 ? segIdx - 1 : 0;
                  setPendingFocus({
                    segIndex: targetIdx,
                    position: segIdx > 0 ? "last" : "first",
                  });
                  return;
                }
                const el = e.target as HTMLTextAreaElement;
                if (e.key === "ArrowUp" && el.selectionStart === 0) {
                  e.preventDefault();
                  focusPrevSegment(segIdx);
                  return;
                }
                if (
                  e.key === "ArrowDown" &&
                  el.selectionEnd === el.value.length
                ) {
                  e.preventDefault();
                  focusNextSegment(segIdx);
                  return;
                }
                handleTabKey(e);
              }}
              disabled={disabled}
              rows={lineCount}
              style={{ resize: "none" }}
            />
          );
        })}
      {!hasContent && (
        <textarea
          ref={(el) => {
            textareaRefs.current[-1] = el;
          }}
          class="w-full bg-transparent outline-none text-sm"
          placeholder="Take a note..."
          value=""
          onInput={(e) => {
            onChange((e.target as HTMLTextAreaElement).value);
            setPendingFocus({ segIndex: 0, position: "last" });
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              onNavigateUp?.();
            }
          }}
          disabled={disabled}
          rows={3}
          style={{ resize: "none" }}
        />
      )}
    </div>
  );
}
