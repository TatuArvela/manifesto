import type { Note, NoteColor } from "@manifesto/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { useUndoRedo } from "../hooks/useUndoRedo.js";
import { buildShareUrl } from "../sharing.js";
import {
  archiveNote,
  createNote,
  restoreNote,
  togglePin,
  trashNote,
  unarchiveNote,
  updateNote,
} from "../state/index.js";
import { showSuccess } from "../state/ui.js";
import { saveVersion } from "../storage/VersionStorage.js";
import { NoteEditor } from "./NoteEditor.js";
import { VersionHistory } from "./VersionHistory.js";

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
  const [showVersions, setShowVersions] = useState(false);

  // Capture original state for version history (set once on mount)
  const originalTitleRef = useRef(note.title);
  const originalContentRef = useRef(note.content);

  const savedRef = useRef(false);

  const maybeSaveVersion = () => {
    if (
      title !== originalTitleRef.current ||
      content !== originalContentRef.current
    ) {
      saveVersion(
        note.id,
        originalTitleRef.current,
        originalContentRef.current,
      );
    }
  };

  const saveAndClose = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (title !== note.title || content !== note.content) {
      updateNote(note.id, { title, content });
    }
    maybeSaveVersion();
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
      // Save version if content changed during this editing session
      if (
        titleRef.current !== originalTitleRef.current ||
        contentRef.current !== originalContentRef.current
      ) {
        saveVersion(
          note.id,
          originalTitleRef.current,
          originalContentRef.current,
        );
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

  if (showVersions) {
    return (
      <VersionHistory
        noteId={note.id}
        color={note.color}
        onRestore={(restoredTitle, restoredContent) => {
          setTitle(restoredTitle);
          setContent(restoredContent);
          updateNote(note.id, {
            title: restoredTitle,
            content: restoredContent,
          });
          setShowVersions(false);
        }}
        onClose={() => setShowVersions(false)}
      />
    );
  }

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
      onShowVersions={() => setShowVersions(true)}
      onShare={() => {
        const url = buildShareUrl({
          title: note.title,
          content: note.content,
          color: note.color,
          font: note.font,
          tags: [...note.tags],
        });
        navigator.clipboard.writeText(url);
        showSuccess("Link copied to clipboard");
      }}
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
