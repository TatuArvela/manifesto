import { type NoteColor, NoteColor as NoteColorEnum } from "@manifesto/shared";
import { useCallback, useState } from "preact/hooks";
import { noteColorMap, noteEdgeColors } from "../colors.js";
import { createNote, defaultNoteColor, filter, pickDefaultColor } from "../state/index.js";
import { NoteEditor } from "./NoteEditor.js";

const ctaMessages = [
  "What's on your mind? ✏️",
  "Jot something down! 📝",
  "Got an idea? Drop it here! 💡",
  "Take a note... 🗒️",
  "Capture a thought! 🦋",
  "Don't forget this! 📌",
  "Quick, write it down! ⚡",
  "Your next big idea starts here ✨",
  "Scribble something! 🖊️",
  "What are you thinking about? 🤔",
  "Note to self... 💭",
  "Pin this thought! 📍",
];

function randomCta(exclude?: string): string {
  const pool = exclude ? ctaMessages.filter((m) => m !== exclude) : ctaMessages;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function NoteInput() {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState<NoteColor>(() => pickDefaultColor());
  const [nextColor, setNextColor] = useState<NoteColor>(() => pickDefaultColor());
  const [pinned, setPinned] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [closing, setClosing] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [topCta, setTopCta] = useState(() => randomCta());
  const [nextCta, setNextCta] = useState(() => randomCta(topCta));

  if (filter.value !== "active") return null;

  const reset = () => {
    setTitle("");
    setContent("");
    setColor(nextColor);
    setNextColor(pickDefaultColor());
    setPinned(false);
    setTags([]);
  };

  const cycleCta = useCallback(() => {
    setTopCta(nextCta);
    setNextCta(randomCta(nextCta));
  }, [nextCta]);

  const openModal = () => {
    setLifting(true);
    setExpanded(true);
    setTimeout(() => setLifting(false), 400);
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
          tags,
        });
      }
      reset();
      setClosing(false);
      setExpanded(false);
      cycleCta();
    }, 150);
  };

  const discardNote = () => {
    setClosing(true);
    setTimeout(() => {
      reset();
      setClosing(false);
      setExpanded(false);
      cycleCta();
    }, 150);
  };

  const isDark = document.documentElement.classList.contains("dark");
  const edgeKey = isDark ? "dark" : "light";
  const rainbowEdges: NoteColor[] = [
    NoteColorEnum.Red,
    NoteColorEnum.Yellow,
    NoteColorEnum.Blue,
  ];
  const spacer = isDark ? "#1f2937" : "#f3f4f6";
  const end = isDark ? "#374151" : "#e5e7eb";
  const rainbowGradientStyle = {
    background: `linear-gradient(to bottom, ${rainbowEdges
      .flatMap((c, i) => {
        const edge = noteEdgeColors[c][edgeKey];
        const y = i * 2;
        return [`${edge} ${y}px`, `${edge} ${y + 1}px`, `${spacer} ${y + 1}px`];
      })
      .join(", ")}, ${end} 5px)`,
  };

  const topNoteHidden = lifting || (expanded && !closing) || closing;
  const topNoteClass = lifting
    ? "note-stack-top note-lift-off"
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
          <div class={`note-stack-next border ${noteColorMap[nextColor].bg} ${noteColorMap[nextColor].border}`}>
            <div class="px-5 py-5 text-sm text-gray-400 dark:text-gray-500">
              {nextCta}
            </div>
          </div>
          <div class={`${topNoteClass} border ${noteColorMap[color].bg} ${noteColorMap[color].border}`}>
            <div class="px-5 py-5 text-sm text-gray-400 dark:text-gray-500">
              {topCta}
            </div>
          </div>
        </div>
        {/* Stack base — visible thickness at bottom */}
        <div
          class="note-stack-base"
          style={defaultNoteColor.value === "random" ? rainbowGradientStyle : undefined}
        />
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
