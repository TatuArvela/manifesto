import type { Note, NoteColor } from "@manifesto/shared";
import { useEffect, useRef } from "preact/hooks";
import { useUndoRedo } from "../hooks/useUndoRedo.js";
import {
  archiveNote,
  createNote,
  restoreNote,
  togglePin,
  trashNote,
  unarchiveNote,
  updateNote,
} from "../state/index.js";
import { NoteEditor } from "./NoteEditor.js";

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

export function NoteCardEditor({
  note,
  onClose,
}: {
  note: Note;
  onClose: () => void;
}) {
  const { title, content, setTitle, setContent, undo, redo, canUndo, canRedo } =
    useUndoRedo(note.title, note.content);
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

  // Auto-save on any title/content change (typing, undo, redo)
  useEffect(() => {
    if (title === note.title && content === note.content) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      updateNote(note.id, { title, content });
    }, 500);
  }, [title, content]);

  return (
    <NoteEditor
      title={title}
      onTitleChange={setTitle}
      content={content}
      onContentChange={setContent}
      color={note.color}
      onColorChange={(color) =>
        updateNote(note.id, { color: color as NoteColor })
      }
      font={note.font}
      onFontChange={(font) => updateNote(note.id, { font })}
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
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
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
          font: note.font,
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
      archived={note.archived}
      trashed={note.trashed}
      onDelete={() => {
        if (note.trashed) {
          restoreNote(note.id);
        } else {
          trashNote(note.id);
        }
        onClose();
      }}
    />
  );
}
