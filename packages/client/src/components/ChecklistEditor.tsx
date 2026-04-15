import { GripVertical, X } from "lucide-preact";
import type { Ref } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";

const CHECKBOX_RE = /^(\s*)(?:- )?\[([ x])\] (.*)$/i;
const INDENT_STEP = 2;

interface ChecklistLine {
  indent: number;
  checked: boolean;
  text: string;
}

export interface ChecklistEditorHandle {
  focusFirst: () => void;
  focusLast: () => void;
}

function parseLine(line: string): ChecklistLine | null {
  const m = line.match(CHECKBOX_RE);
  if (!m) return null;
  return {
    indent: m[1].length,
    checked: m[2].toLowerCase() === "x",
    text: m[3],
  };
}

function serializeLine(item: ChecklistLine): string {
  const pad = " ".repeat(item.indent);
  const mark = item.checked ? "x" : " ";
  return `${pad}- [${mark}] ${item.text}`;
}

/**
 * Renders checklist lines as interactive rows with drag handles.
 * `lines` is the raw checklist text lines for this segment.
 * `onChange` receives the updated lines array (may include non-checklist
 * lines when Enter is pressed on an empty item, causing re-segmentation).
 */
export function ChecklistEditor({
  lines,
  onChange,
  disabled,
  checkboxOnly,
  editorRef,
  onNavigateUp,
  onNavigateDown,
  onItemDragStart,
  onItemDropExternal,
  wasDroppedExternally,
}: {
  lines: string[];
  onChange: (newLines: string[]) => void;
  disabled?: boolean;
  /** When true, only checkbox toggling is allowed (drag handles and text editing are disabled) */
  checkboxOnly?: boolean;
  editorRef?: Ref<ChecklistEditorHandle>;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  /** Called when a drag starts, so the parent can track cross-segment drags */
  onItemDragStart?: (lineIndex: number) => void;
  /** Called when an item from another checklist is dropped here */
  onItemDropExternal?: (targetIndex: number) => void;
  /** Called on drag end so the parent can check if a cross-drop occurred */
  wasDroppedExternally?: () => boolean;
}) {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragStartX = useRef(0);
  const dragOriginalIndent = useRef(0);
  const [dragIndentDelta, setDragIndentDelta] = useState(0);
  const [focusRequest, setFocusRequest] = useState<{
    idx: number;
    cursorPos?: number;
  } | null>(null);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const items: ChecklistLine[] = lines.map(
    (l) => parseLine(l) ?? { indent: 0, checked: false, text: l },
  );

  // Expose focus methods
  useImperativeHandle(editorRef ?? null, () => ({
    focusFirst: () => {
      inputRefs.current[0]?.focus();
    },
    focusLast: () => {
      inputRefs.current[items.length - 1]?.focus();
    },
  }));

  // Handle focus requests after render
  useEffect(() => {
    if (focusRequest !== null) {
      const el = inputRefs.current[focusRequest.idx];
      if (el) {
        el.focus();
        if (focusRequest.cursorPos !== undefined) {
          el.setSelectionRange(focusRequest.cursorPos, focusRequest.cursorPos);
        }
      }
      setFocusRequest(null);
    }
  }, [focusRequest]);

  const updateItem = (idx: number, update: Partial<ChecklistLine>) => {
    const updated = { ...items[idx], ...update };
    const newLines = [...lines];
    newLines[idx] = serializeLine(updated);
    onChange(newLines);
  };

  const handleKeyDown = (e: KeyboardEvent, idx: number) => {
    if (disabled) return;
    const el = e.target as HTMLInputElement;
    const item = items[idx];

    if (e.key === "Enter") {
      e.preventDefault();
      if (item.text.trim() === "") {
        // Empty item: convert to empty text line (causes re-segmentation)
        const newLines = [...lines];
        newLines[idx] = "";
        onChange(newLines);
      } else {
        // Split at cursor position
        const cursorPos = el.selectionStart ?? item.text.length;
        const textBefore = item.text.slice(0, cursorPos);
        const textAfter = item.text.slice(cursorPos);
        const newLines = [...lines];
        newLines[idx] = serializeLine({ ...item, text: textBefore });
        newLines.splice(
          idx + 1,
          0,
          serializeLine({
            indent: item.indent,
            checked: false,
            text: textAfter,
          }),
        );
        onChange(newLines);
        setFocusRequest({ idx: idx + 1, cursorPos: 0 });
      }
      return;
    }

    if (e.key === "Backspace" && item.text === "") {
      e.preventDefault();
      if (lines.length === 1) return; // Don't delete the last item
      const newLines = [...lines];
      if (idx === 0) {
        // First item: convert to empty text line (creates text segment above)
        newLines[0] = "";
      } else {
        newLines.splice(idx, 1);
        setFocusRequest({ idx: idx - 1 });
      }
      onChange(newLines);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      const newIndent = e.shiftKey
        ? Math.max(0, item.indent - INDENT_STEP)
        : item.indent + INDENT_STEP;
      updateItem(idx, { indent: newIndent });
      setFocusRequest({ idx, cursorPos: el.selectionStart ?? undefined });
      return;
    }

    if (e.key === "ArrowUp") {
      if (idx > 0) {
        e.preventDefault();
        setFocusRequest({
          idx: idx - 1,
          cursorPos: el.selectionStart ?? undefined,
        });
      } else if (onNavigateUp) {
        e.preventDefault();
        onNavigateUp();
      }
      return;
    }

    if (e.key === "ArrowDown") {
      if (idx < items.length - 1) {
        e.preventDefault();
        setFocusRequest({
          idx: idx + 1,
          cursorPos: el.selectionStart ?? undefined,
        });
      } else if (onNavigateDown) {
        e.preventDefault();
        onNavigateDown();
      }
      return;
    }
  };

  // --- Drag and drop ---

  const handleDragStart = (e: DragEvent, idx: number) => {
    if (disabled) return;
    setDragIndex(idx);
    dragStartX.current = e.clientX;
    dragOriginalIndent.current = items[idx].indent;
    setDragIndentDelta(0);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
    }
    onItemDragStart?.(idx);
  };

  const handleDrag = (e: DragEvent) => {
    if (dragIndex === null || e.clientX === 0) return;
    const deltaX = e.clientX - dragStartX.current;
    const indentSteps = Math.round(deltaX / 30);
    const newIndent = Math.max(
      0,
      dragOriginalIndent.current + indentSteps * INDENT_STEP,
    );
    setDragIndentDelta(newIndent - dragOriginalIndent.current);
  };

  const containerRef = useRef<HTMLDivElement>(null);

  const handleDragOver = (e: DragEvent, idx: number) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    setDragOverIndex(idx);
  };

  const handleDragLeave = (e: DragEvent) => {
    // Clear indicator when drag leaves this checklist entirely
    if (
      containerRef.current &&
      e.relatedTarget instanceof Node &&
      !containerRef.current.contains(e.relatedTarget)
    ) {
      setDragOverIndex(null);
    }
  };

  const applyDrop = (dropIdx: number) => {
    if (dragIndex === null) return;

    const newLines = [...lines];
    const parsed = parseLine(newLines[dragIndex]);
    if (!parsed) return;
    parsed.indent = Math.max(0, parsed.indent + dragIndentDelta);
    const serialized = serializeLine(parsed);

    if (dragIndex !== dropIdx) {
      newLines.splice(dragIndex, 1);
      const adjustedTo = dropIdx > dragIndex ? dropIdx - 1 : dropIdx;
      newLines.splice(adjustedTo, 0, serialized);
    } else {
      newLines[dragIndex] = serialized;
    }

    onChange(newLines);
  };

  const handleDrop = (e: DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIndex === null) {
      // Drop came from another checklist
      onItemDropExternal?.(dropIdx);
    } else {
      applyDrop(dropIdx);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    setDragIndentDelta(0);
  };

  const handleDragEnd = () => {
    if (
      dragIndex !== null &&
      dragIndentDelta !== 0 &&
      !wasDroppedExternally?.()
    ) {
      applyDrop(dragIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
    setDragIndentDelta(0);
  };

  // Reset refs array size
  inputRefs.current.length = items.length;

  const isAfterLastDragOver =
    dragOverIndex === items.length && dragIndex !== items.length;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop container
    <div
      class="flex flex-col pt-2"
      ref={containerRef}
      onDragLeave={handleDragLeave}
    >
      {items.map((item, idx) => {
        const isDragging = dragIndex === idx;
        const isDragOver = dragOverIndex === idx && dragIndex !== idx;
        const indentPx = isDragging
          ? (item.indent + dragIndentDelta) * (30 / INDENT_STEP)
          : item.indent * (30 / INDENT_STEP);

        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop target
          <div
            key={idx}
            class={`group/row flex items-center gap-1 py-1.5 ${isDragging ? "opacity-50" : ""}`}
            style={{
              paddingLeft: `${Math.max(0, indentPx)}px`,
              boxShadow: isDragOver ? "inset 0 2px 0 0 #60a5fa" : undefined,
            }}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
          >
            {/* biome-ignore lint/a11y/noStaticElementInteractions: drag handle */}
            <div
              class={`shrink-0 ${disabled || checkboxOnly ? "text-black/20 dark:text-white/20" : "text-black/40 dark:text-white/40 cursor-grab active:cursor-grabbing"}`}
              draggable={!disabled && !checkboxOnly}
              onDragStart={(e) => handleDragStart(e, idx)}
              onDrag={handleDrag}
              onDragEnd={handleDragEnd}
            >
              <GripVertical class="w-4 h-4" />
            </div>
            <input
              type="checkbox"
              class="w-4 h-4 rounded appearance-none border-2 border-gray-500 dark:border-gray-400 shrink-0 cursor-pointer hover:border-gray-600 dark:hover:border-gray-300 transition-colors checkbox-custom"
              checked={item.checked}
              disabled={disabled}
              onChange={() => updateItem(idx, { checked: !item.checked })}
            />
            <input
              ref={(el) => {
                inputRefs.current[idx] = el;
              }}
              type="text"
              class={`flex-1 bg-transparent outline-none text-sm min-w-0 ${item.checked ? "line-through opacity-60" : ""}`}
              value={item.text}
              disabled={disabled || checkboxOnly}
              onInput={(e) =>
                updateItem(idx, {
                  text: (e.target as HTMLInputElement).value,
                })
              }
              onKeyDown={(e) => handleKeyDown(e, idx)}
              onFocus={() => setFocusedIndex(idx)}
              onBlur={(e) => {
                // Don't clear if clicking the delete button
                if (
                  e.relatedTarget instanceof HTMLElement &&
                  e.relatedTarget.dataset.checklistDelete
                ) {
                  return;
                }
                setFocusedIndex(null);
              }}
            />
            {!disabled && !checkboxOnly && (
              <button
                type="button"
                data-checklist-delete="true"
                class={`shrink-0 p-0.5 rounded text-black/30 dark:text-white/30 hover:text-black/60 dark:hover:text-white/60 transition-opacity ${focusedIndex === idx ? "opacity-100" : "opacity-0 group-hover/row:opacity-100"}`}
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const newLines = [...lines];
                  newLines.splice(idx, 1);
                  if (newLines.length === 0) {
                    newLines.push("");
                  }
                  onChange(newLines);
                  setFocusedIndex(null);
                }}
                aria-label="Remove item"
              >
                <X class="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop zone after the last item */}
      <div
        class="h-2"
        style={{
          boxShadow: isAfterLastDragOver
            ? "inset 0 -2px 0 0 #60a5fa"
            : undefined,
        }}
        onDragOver={(e) => handleDragOver(e, items.length)}
        onDrop={(e) => handleDrop(e, items.length)}
      />
    </div>
  );
}

/** Returns true if a line is a checklist item */
export function isChecklistLine(line: string): boolean {
  return CHECKBOX_RE.test(line);
}
