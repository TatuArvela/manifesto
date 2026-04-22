import type { Note, NoteColor } from "@manifesto/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatDateTime, t } from "../i18n/index.js";
import { buildShareUrl } from "../sharing.js";
import {
  archiveNote,
  createNote,
  notes,
  restoreNote,
  togglePin,
  trashNote,
  unarchiveNote,
  updateNote,
} from "../state/index.js";
import { showSuccess } from "../state/ui.js";
import { saveVersion } from "../storage/VersionStorage.js";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "../utils/importExport.js";
import { makeStubPreview } from "../utils/linkPreview.js";
import { NoteEditor } from "./NoteEditor.js";
import { VersionHistory } from "./VersionHistory.js";

export function NoteCardEditor({
  note,
  onClose,
}: {
  note: Note;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
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

  const titleRef = useRef(title);
  const contentRef = useRef(content);
  titleRef.current = title;
  contentRef.current = content;

  const saveAndCloseRef = useRef<() => void>(() => {});
  saveAndCloseRef.current = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (title !== note.title || content !== note.content) {
      updateNote(note.id, { title, content });
    }
    maybeSaveVersion();
    savedRef.current = true;
    onClose();
  };
  const saveAndClose = () => saveAndCloseRef.current();

  // Save pending changes on unmount (e.g. backdrop click)
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
      if (e.key === "Escape") saveAndCloseRef.current();
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  // Auto-save on any title/content change
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
      images={note.images}
      onAddImages={(urls) =>
        updateNote(note.id, { images: [...note.images, ...urls] })
      }
      onRemoveImage={(index) =>
        updateNote(note.id, {
          images: note.images.filter((_, i) => i !== index),
        })
      }
      linkPreviews={note.linkPreviews}
      onAddLinkPreview={(url) => {
        const current = notes.value.find((n) => n.id === note.id);
        if (!current) return;
        if (current.linkPreviews.some((p) => p.url === url)) return;
        updateNote(note.id, {
          linkPreviews: [...current.linkPreviews, makeStubPreview(url)],
        });
      }}
      onRemoveLinkPreview={(index) =>
        updateNote(note.id, {
          linkPreviews: note.linkPreviews.filter((_, i) => i !== index),
        })
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
      reminder={note.reminder}
      onReminderChange={(reminder) => updateNote(note.id, { reminder })}
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
        showSuccess(t("noteCard.linkCopied"));
      }}
      onDone={saveAndClose}
      metadata={
        <div class="flex gap-3 mt-3 text-xs text-black/40 dark:text-white/40">
          <span>
            {t("editor.metadata.created", {
              date: formatDateTime(note.createdAt),
            })}
          </span>
          {note.updatedAt !== note.createdAt && (
            <span>
              {t("editor.metadata.edited", {
                date: formatDateTime(note.updatedAt),
              })}
            </span>
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
      onExportMarkdown={() => downloadNoteAsMarkdown({ title, content })}
      onExportJson={() => downloadNoteAsJson({ ...note, title, content })}
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
