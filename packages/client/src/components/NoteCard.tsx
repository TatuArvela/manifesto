import type { Note, NoteColor } from "@manifesto/shared";
import clsx from "clsx";
import DOMPurify from "dompurify";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Palette,
  Pin,
  PinOff,
  Trash2,
  Undo2,
  X,
} from "lucide-preact";
import { Marked } from "marked";
import { useEffect, useRef, useState } from "preact/hooks";
import { colorPickerColors, noteColorMap } from "../colors.js";
import {
  archiveNote,
  createNote,
  deleteNote,
  editingNoteId,
  filter,
  noteSize,
  restoreNote,
  toggleCheckbox,
  togglePin,
  trashNote,
  unarchiveNote,
  updateNote,
  viewMode,
} from "../state/index.js";
import { isChecklistLine } from "./ChecklistEditor.js";
import { iconBtnClass, NoteEditor } from "./NoteEditor.js";
import { Tooltip } from "./Tooltip.js";

const marked = new Marked();

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Normalize shorthand `[] text` / `[x] text` to GFM `- [ ] text` / `- [x] text` */
function normalizeChecklists(text: string): string {
  return text.replace(/^(\s*)(\[[ x]\] )/gim, "$1- $2");
}

/**
 * Groups consecutive lines into segments: either a block of checklist items
 * or a block of regular lines (rendered as markdown).
 */
function renderContentPreview(
  note: Note,
  onCheckboxToggle: (lineIndex: number) => void,
  hasTitle: boolean,
) {
  if (!note.content) return null;

  const lines = note.content.split("\n");
  // Group lines into segments: { type: "checklist" | "text", startIndex, lines }
  const segments: {
    type: "checklist" | "text";
    startIndex: number;
    lines: string[];
  }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const isCheckbox = /^\s*(?:- )?\[[x ]\] /i.test(lines[i]);
    const type = isCheckbox ? "checklist" : "text";
    const last = segments[segments.length - 1];
    if (last && last.type === type) {
      last.lines.push(lines[i]);
    } else {
      segments.push({ type, startIndex: i, lines: [lines[i]] });
    }
  }

  // Count leading/trailing empty lines per segment for spacing
  const hasLeadingBlank = (seg: (typeof segments)[number]) =>
    seg.lines.length > 0 && seg.lines[0].trim() === "";
  const hasTrailingBlank = (seg: (typeof segments)[number]) =>
    seg.lines.length > 0 && seg.lines[seg.lines.length - 1].trim() === "";

  return (
    <div
      class={`${hasTitle ? "mt-2" : ""} text-sm text-gray-600 dark:text-gray-400 line-clamp-12`}
    >
      {segments.map((seg, segIdx) => {
        // Add top margin if this segment had a blank line before it
        // (trailing blank of previous segment or leading blank of this one)
        const prev = segIdx > 0 ? segments[segIdx - 1] : null;
        const gapAbove =
          segIdx > 0 && (hasTrailingBlank(prev!) || hasLeadingBlank(seg));

        if (seg.type === "checklist") {
          return (
            <div
              key={seg.startIndex}
              class={`flex flex-col items-start space-y-1.5 ${gapAbove ? "mt-3" : segIdx > 0 ? "mt-1" : ""}`}
            >
              {seg.lines.map((line, j) => {
                const lineIndex = seg.startIndex + j;
                const indent = line.match(/^(\s*)/)?.[1].length ?? 0;
                const unchecked = line.match(/^\s*(?:- )?\[ \] (.*)$/);
                const checked = line.match(/^\s*(?:- )?\[x\] (.*)$/i);
                if (unchecked) {
                  return (
                    <div
                      key={lineIndex}
                      class="inline-flex items-start gap-2"
                      style={{ paddingLeft: `${indent * 0.75}em` }}
                    >
                      <input
                        type="checkbox"
                        class="mt-0.5 w-4 h-4 rounded appearance-none border-2 border-gray-400 dark:border-gray-500 shrink-0 cursor-pointer hover:border-gray-600 dark:hover:border-gray-300 transition-colors checkbox-custom"
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
                      style={{ paddingLeft: `${indent * 0.75}em` }}
                    >
                      <input
                        type="checkbox"
                        class="mt-0.5 w-4 h-4 rounded appearance-none border-2 border-gray-400 dark:border-gray-500 shrink-0 cursor-pointer hover:border-gray-600 dark:hover:border-gray-300 transition-colors checkbox-custom"
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
        if (!text.trim()) return null;
        const html = DOMPurify.sanitize(
          marked.parse(text, { breaks: true }) as string,
        );
        return (
          <div
            key={seg.startIndex}
            class={`prose prose-sm dark:prose-invert max-w-none ${gapAbove ? "mt-3" : segIdx > 0 ? "mt-1" : ""}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}

export function NoteCard({ note }: { note: Note }) {
  const isEditing = editingNoteId.value === note.id;
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const colors = noteColorMap[note.color];
  const isTrashView = filter.value === "trash";
  const isArchiveView = filter.value === "archived";
  // Show modal when editing starts
  useEffect(() => {
    if (isEditing) {
      setShowModal(true);
      setClosing(false);
    }
  }, [isEditing]);

  const closeModal = () => {
    setClosing(true);
    setTimeout(() => {
      setShowModal(false);
      setClosing(false);
      editingNoteId.value = null;
    }, 150);
  };

  const handleClick = () => {
    if (!isTrashView && !isEditing) {
      editingNoteId.value = note.id;
    }
  };

  return (
    <>
      <article
        class={clsx(
          colors.bg,
          colors.border,
          "border p-4 transition-shadow duration-150 group relative select-none overflow-hidden flex flex-col",
          !isTrashView && "pb-2",
          "hover:shadow-md",
          isEditing && !closing && "opacity-20",
          noteSize.value === "square" &&
            viewMode.value === "list" &&
            "w-full max-w-sm mx-auto",
        )}
        style={{
          aspectRatio: noteSize.value === "square" ? "1/1" : "auto",
        }}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleClick();
        }}
      >
        {/* Top-right corner: pin button */}
        <div
          class="absolute top-2 right-2 flex items-center gap-0.5 text-gray-400 dark:text-gray-500 group-hover:text-gray-800 dark:group-hover:text-gray-200 transition-colors duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {!isTrashView && (
            <Tooltip label={note.pinned ? "Unpin" : "Pin"}>
              <button
                type="button"
                class={`${iconBtnClass} ${note.pinned ? "opacity-100 group/pin" : "opacity-0 group-hover:opacity-100"} transition-opacity`}
                onClick={() => togglePin(note.id)}
                aria-label={note.pinned ? "Unpin" : "Pin"}
              >
                {note.pinned ? (
                  <span class="relative block w-4 h-4">
                    <Pin class="w-4 h-4 absolute inset-0 transition-opacity duration-200 group-hover/pin:opacity-0" />
                    <PinOff class="w-4 h-4 absolute inset-0 transition-opacity duration-200 opacity-0 group-hover/pin:opacity-100" />
                  </span>
                ) : (
                  <Pin class="w-4 h-4" />
                )}
              </button>
            </Tooltip>
          )}
        </div>

        {note.title && (
          <h3 class="font-medium text-base leading-snug pr-6">{note.title}</h3>
        )}

        {renderContentPreview(
          note,
          (lineIndex) => toggleCheckbox(note.id, lineIndex),
          !!note.title,
        )}

        {note.tags.length > 0 && (
          <div class="mt-3 flex flex-wrap gap-1">
            {note.tags.map((tag) => (
              <span
                key={tag}
                class="inline-block px-2 py-0.5 text-xs rounded-full bg-gray-200/60 dark:bg-gray-700/60"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        <div
          class="mt-auto pt-3 -ml-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {isTrashView ? (
            <>
              <Tooltip label="Restore">
                <button
                  type="button"
                  class={iconBtnClass}
                  onClick={() => restoreNote(note.id)}
                  aria-label="Restore note"
                >
                  <Undo2 class="w-4 h-4" />
                </button>
              </Tooltip>
              <Tooltip label="Delete permanently">
                <button
                  type="button"
                  class={iconBtnClass}
                  onClick={() => deleteNote(note.id)}
                  aria-label="Delete permanently"
                >
                  <X class="w-4 h-4" />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              {/* Color picker */}
              <div class="relative flex">
                <Tooltip label="Color">
                  <button
                    type="button"
                    class={iconBtnClass}
                    onClick={() => setShowColorPicker(!showColorPicker)}
                    aria-label="Change color"
                  >
                    <Palette class="w-4 h-4" />
                  </button>
                </Tooltip>
                {showColorPicker && (
                  <>
                    <div
                      class="fixed inset-0 z-10"
                      onClick={() => setShowColorPicker(false)}
                    />
                    <div class="absolute bottom-full left-0 mb-2 p-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 flex gap-1 z-20">
                      {colorPickerColors.map((c) => (
                        <Tooltip key={c.value} label={c.label}>
                          <button
                            type="button"
                            class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${note.color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                            onClick={() =>
                              updateNote(note.id, {
                                color: c.value as NoteColor,
                              })
                            }
                            aria-label={c.label}
                          />
                        </Tooltip>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Duplicate */}
              <Tooltip label="Duplicate">
                <button
                  type="button"
                  class={iconBtnClass}
                  onClick={() =>
                    createNote({
                      title: note.title,
                      content: note.content,
                      color: note.color,
                      tags: [...note.tags],
                    })
                  }
                  aria-label="Duplicate note"
                >
                  <Copy class="w-4 h-4" />
                </button>
              </Tooltip>

              {isArchiveView ? (
                <Tooltip label="Unarchive">
                  <button
                    type="button"
                    class={iconBtnClass}
                    onClick={() => unarchiveNote(note.id)}
                    aria-label="Unarchive"
                  >
                    <ArchiveRestore class="w-4 h-4" />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip label="Archive">
                  <button
                    type="button"
                    class={iconBtnClass}
                    onClick={() => archiveNote(note.id)}
                    aria-label="Archive"
                  >
                    <Archive class="w-4 h-4" />
                  </button>
                </Tooltip>
              )}
              <Tooltip label="Delete">
                <button
                  type="button"
                  class={iconBtnClass}
                  onClick={() => trashNote(note.id)}
                  aria-label="Delete"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </Tooltip>
            </>
          )}
        </div>

        {isTrashView && note.trashedAt && (
          <p class="mt-2 text-xs text-gray-400">
            Trashed {new Date(note.trashedAt).toLocaleDateString()}
          </p>
        )}
      </article>

      {showModal && (
        <>
          <div
            class={`fixed inset-0 bg-black/30 z-20 transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"}`}
            onClick={closeModal}
          />
          <div
            class={`fixed inset-0 z-30 flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
          >
            <div class="pointer-events-auto w-full max-w-2xl">
              <NoteCardEditor
                note={note}
                isArchiveView={isArchiveView}
                onClose={closeModal}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

// --- Modal editor ---

function NoteCardEditor({
  note,
  isArchiveView,
  onClose,
}: {
  note: Note;
  isArchiveView: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const savedRef = useRef(false);

  const saveAndClose = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (title !== note.title || content !== note.content) {
      updateNote(note.id, { title, content });
    }
    savedRef.current = true;
    onClose();
  };

  // Save pending changes on unmount (e.g. backdrop click)
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  titleRef.current = title;
  contentRef.current = content;
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedRef.current) return;
      if (
        titleRef.current !== note.title ||
        contentRef.current !== note.content
      ) {
        updateNote(note.id, {
          title: titleRef.current,
          content: contentRef.current,
        });
      }
    };
  }, []);

  // Escape to close
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") saveAndClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, [title, content]);

  const scheduleSave = (changes: Partial<Note>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateNote(note.id, changes);
    }, 500);
  };

  const handleTitleInput = (value: string) => {
    setTitle(value);
    scheduleSave({ title: value, content });
  };

  const handleContentInput = (value: string) => {
    setContent(value);
    scheduleSave({ title, content: value });
  };

  return (
    <NoteEditor
      title={title}
      onTitleChange={handleTitleInput}
      content={content}
      onContentChange={handleContentInput}
      color={note.color}
      onColorChange={(color) =>
        updateNote(note.id, { color: color as NoteColor })
      }
      pinned={note.pinned}
      onPinToggle={() => togglePin(note.id)}
      tags={note.tags}
      onAddTag={(tag) => {
        if (!note.tags.includes(tag)) {
          updateNote(note.id, { tags: [...note.tags, tag] });
        }
      }}
      onRemoveTag={(tag) =>
        updateNote(note.id, { tags: note.tags.filter((t) => t !== tag) })
      }
      onDone={saveAndClose}
      metadata={
        <div class="flex gap-3 mt-3 text-xs text-black/40 dark:text-white/40">
          <span>Created {formatDateTime(note.createdAt)}</span>
          {note.updatedAt !== note.createdAt && (
            <span>Edited {formatDateTime(note.updatedAt)}</span>
          )}
        </div>
      }
      onDuplicate={() =>
        createNote({
          title: note.title,
          content: note.content,
          color: note.color,
          tags: [...note.tags],
        })
      }
      onArchive={() => {
        if (note.archived) {
          unarchiveNote(note.id);
        } else {
          archiveNote(note.id);
        }
      }}
      archived={note.archived || isArchiveView}
      onDelete={() => {
        trashNote(note.id);
        onClose();
      }}
    />
  );
}
