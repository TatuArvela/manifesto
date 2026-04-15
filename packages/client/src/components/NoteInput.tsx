import {
  type NoteColor,
  NoteColor as NoteColorEnum,
  type NoteFont,
} from "@manifesto/shared";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { noteColorMap, noteEdgeColors } from "../colors.js";
import { useUndoRedo } from "../hooks/useUndoRedo.js";
import {
  activeView,
  createNote,
  defaultNoteColor,
  defaultNoteFont,
  noteSize,
  pickDefaultColor,
  pickDefaultFont,
  theme,
  viewMode,
} from "../state/index.js";
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
  const {
    title,
    content,
    setTitle,
    setContent,
    undo,
    redo,
    canUndo,
    canRedo,
    reset: resetUndoRedo,
  } = useUndoRedo("", "");
  const [color, setColor] = useState<NoteColor>(() => pickDefaultColor());
  const [nextColor, setNextColor] = useState<NoteColor>(() =>
    pickDefaultColor(),
  );
  const [font, setFont] = useState<NoteFont>(() => pickDefaultFont());
  const [pinned, setPinned] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [closing, setClosing] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [liftRotation, setLiftRotation] = useState(0);
  const [topCta, setTopCta] = useState(() => randomCta());
  const [nextCta, setNextCta] = useState(() => randomCta(topCta));

  // Re-pick colors when the default note color setting changes
  const colorSetting = defaultNoteColor.value;
  useEffect(() => {
    setColor(pickDefaultColor());
    setNextColor(pickDefaultColor());
  }, [colorSetting]);

  // Re-pick font when the default note font setting changes
  const fontSetting = defaultNoteFont.value;
  useEffect(() => {
    setFont(pickDefaultFont());
  }, [fontSetting]);

  if (activeView.value !== "active") return null;

  const reset = () => {
    resetUndoRedo("", "");
    setColor(nextColor);
    setNextColor(pickDefaultColor());
    setFont(pickDefaultFont());
    setPinned(false);
    setTags([]);
  };

  const cycleCta = useCallback(() => {
    setTopCta(nextCta);
    setNextCta(randomCta(nextCta));
  }, [nextCta]);

  const openModal = () => {
    setLiftRotation(Math.random() * 16 - 8);
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
          font,
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

  const isDark =
    theme.value === "dark" ||
    (theme.value === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
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

  const isList = viewMode.value === "list";
  const rulerRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState<number | undefined>(undefined);

  useEffect(() => {
    if (isList) return;
    const ruler = rulerRef.current;
    if (!ruler) return;
    const cell = ruler.firstElementChild as HTMLElement;
    if (!cell) return;
    const measure = () => setColWidth(cell.getBoundingClientRect().width);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(ruler);
    return () => obs.disconnect();
  }, [isList]);

  return (
    <>
      {/* Hidden ruler to measure one grid column width */}
      {!isList && (
        <div
          ref={rulerRef}
          class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-x-4 h-0 overflow-hidden pointer-events-none"
          aria-hidden="true"
        >
          <div />
        </div>
      )}
      <div
        class={
          isList
            ? noteSize.value === "square"
              ? "max-w-sm mx-auto mb-12"
              : "mb-12"
            : "mx-auto mb-12"
        }
        style={!isList && colWidth ? { width: `${colWidth}px` } : undefined}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: styled card element */}
        <div
          class="note-stack cursor-pointer"
          onClick={() => !expanded && openModal()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !expanded) openModal();
          }}
        >
          {/* Notes area — top note + next note behind it */}
          <div class="relative">
            <div
              class={`note-stack-next border ${noteColorMap[nextColor].bg} ${noteColorMap[nextColor].border}`}
            >
              <div class="px-5 pt-12 pb-4 text-sm text-gray-400 dark:text-gray-300">
                {nextCta}
              </div>
            </div>
            <div
              class={`${topNoteClass} border ${noteColorMap[color].bg} ${noteColorMap[color].border}`}
              style={
                lifting
                  ? {
                      "--lift-rotate": `${liftRotation}deg`,
                      "--lift-translate": `${-liftRotation * 2}px`,
                    }
                  : undefined
              }
            >
              <div class="px-5 pt-12 pb-4 text-sm text-gray-400 dark:text-gray-300">
                {topCta}
              </div>
            </div>
          </div>
          {/* Stack base — visible thickness at bottom */}
          <div
            class="note-stack-base"
            style={
              defaultNoteColor.value === "random"
                ? rainbowGradientStyle
                : undefined
            }
          />
        </div>
      </div>

      {expanded && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
          <div
            class={`fixed inset-0 bg-black/50 z-20 transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"}`}
            role="presentation"
            onClick={closeModal}
            onKeyDown={() => {}}
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
                font={font}
                onFontChange={setFont}
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
                onUndo={undo}
                onRedo={redo}
                canUndo={canUndo}
                canRedo={canRedo}
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
