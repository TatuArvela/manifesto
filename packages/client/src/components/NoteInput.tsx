import type { NoteColor } from "@manifesto/shared";
import { LockLevel, NoteColor as NoteColorEnum } from "@manifesto/shared";
import { useState } from "preact/hooks";
import { createNote, filter } from "../state/index.js";
import { NoteEditor } from "./NoteEditor.js";

export function NoteInput() {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState<NoteColor>(NoteColorEnum.Default);
  const [pinned, setPinned] = useState(false);
  const [lock, setLock] = useState<LockLevel>(LockLevel.Unlocked);
  const [tags, setTags] = useState<string[]>([]);
  const [closing, setClosing] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [landing, setLanding] = useState(false);

  if (filter.value !== "active") return null;

  const reset = () => {
    setTitle("");
    setContent("");
    setColor(NoteColorEnum.Default);
    setPinned(false);
    setLock(LockLevel.Unlocked);
    setTags([]);
  };

  const openModal = () => {
    setLifting(true);
    setTimeout(() => {
      setLifting(false);
      setExpanded(true);
    }, 300);
  };

  const closeModal = () => {
    setClosing(true);
    setTimeout(() => {
      if (title.trim() || content.trim()) {
        createNote({
          title: title.trim(),
          content: content.trim(),
          color,
          pinned,
          lock,
          tags,
        });
      }
      reset();
      setClosing(false);
      setExpanded(false);
      setLanding(true);
      setTimeout(() => setLanding(false), 300);
    }, 150);
  };

  const discardNote = () => {
    setClosing(true);
    setTimeout(() => {
      reset();
      setClosing(false);
      setExpanded(false);
      setLanding(true);
      setTimeout(() => setLanding(false), 300);
    }, 150);
  };

  const topNoteHidden = lifting || (expanded && !closing) || (closing);
  const topNoteClass = lifting
    ? "note-stack-top note-lift-off"
    : landing
      ? "note-stack-top note-land"
      : topNoteHidden
        ? "note-stack-top note-hidden"
        : "note-stack-top";

  return (
    <>
      <div
        class="note-stack max-w-md mx-auto mb-12 cursor-pointer"
        onClick={() => !expanded && openModal()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !expanded) openModal();
        }}
      >
        {/* Notes area — top note + next note behind it */}
        <div class="relative">
          <div class="note-stack-next" />
          <div class={topNoteClass}>
            <div class="px-5 py-5 text-sm text-gray-400 dark:text-gray-500">
              Take a note...
            </div>
          </div>
        </div>
        {/* Stack base — visible thickness at bottom */}
        <div class="note-stack-base" />
      </div>

      {expanded && (
        <>
          <div
            class={`fixed inset-0 bg-black/30 z-20 transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"}`}
            onClick={closeModal}
          />
          <div
            class={`fixed inset-0 z-30 flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
          >
            <div class="pointer-events-auto w-full max-w-2xl">
              <NoteEditor
                title={title}
                onTitleChange={setTitle}
                content={content}
                onContentChange={setContent}
                color={color}
                onColorChange={setColor}
                pinned={pinned}
                onPinToggle={() => setPinned(!pinned)}
                lock={lock}
                onLockChange={setLock}
                tags={tags}
                onAddTag={(tag) => {
                  if (!tags.includes(tag)) {
                    setTags([...tags, tag]);
                  }
                }}
                onRemoveTag={(tag) => setTags(tags.filter((t) => t !== tag))}
                onDone={closeModal}
                onDelete={discardNote}
                deleteLabel="Discard"
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}
