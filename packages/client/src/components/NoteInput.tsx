import {
  type LinkPreview,
  type Note,
  type NoteColor,
  NoteColor as NoteColorEnum,
  type NoteFont,
} from "@manifesto/shared";
import { Plus } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { ulid } from "ulid";
import { noteColorMap } from "../colors.js";
import { type MessageKey, t } from "../i18n/index.js";
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
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "../utils/importExport.js";
import { makeStubPreview } from "../utils/linkPreview.js";
import { NoteEditor } from "./NoteEditor.js";

const ctaKeys: MessageKey[] = [
  "cta.0",
  "cta.1",
  "cta.2",
  "cta.3",
  "cta.4",
  "cta.5",
  "cta.6",
  "cta.7",
  "cta.8",
  "cta.9",
  "cta.10",
  "cta.11",
];

function randomCta(exclude?: string): string {
  const all = ctaKeys.map((k) => t(k));
  const pool = exclude ? all.filter((m) => m !== exclude) : all;
  return pool[Math.floor(Math.random() * pool.length)];
}

export function NoteInput() {
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [color, setColor] = useState<NoteColor>(() => pickDefaultColor());
  const [stackColor, setStackColor] = useState<NoteColor>(color);
  const [font, setFont] = useState<NoteFont>(() => pickDefaultFont());
  const [pinned, setPinned] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [linkPreviews, setLinkPreviews] = useState<LinkPreview[]>([]);
  const [closing, setClosing] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [topCta, setTopCta] = useState(() => randomCta());
  const [nextCta, setNextCta] = useState(() => randomCta(topCta));

  // Re-pick colors when the default note color setting changes
  const colorSetting = defaultNoteColor.value;
  useEffect(() => {
    const c = pickDefaultColor();
    setColor(c);
    setStackColor(c);
  }, [colorSetting]);

  // Re-pick font when the default note font setting changes
  const fontSetting = defaultNoteFont.value;
  useEffect(() => {
    setFont(pickDefaultFont());
  }, [fontSetting]);

  if (activeView.value !== "active") return null;

  const reset = () => {
    setTitle("");
    setContent("");
    setColor(stackColor);
    setFont(pickDefaultFont());
    setPinned(false);
    setTags([]);
    setImages([]);
    setLinkPreviews([]);
  };

  const cycleCta = useCallback(() => {
    setTopCta(nextCta);
    setNextCta(randomCta(nextCta));
  }, [nextCta]);

  const openModal = () => {
    setLifting(true);
    setExpanded(true);
    setStackColor(pickDefaultColor());
    setTimeout(() => setLifting(false), 400);
  };

  const closeModal = () => {
    setClosing(true);
    setTimeout(() => {
      if (
        title.trim() ||
        content.trim() ||
        images.length > 0 ||
        linkPreviews.length > 0
      ) {
        createNote({
          title: title.trim(),
          content: content.trim(),
          color,
          font,
          pinned,
          tags,
          images,
          linkPreviews,
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
              ? "max-w-sm mx-auto mb-12 hidden md:block"
              : "mb-12 hidden md:block"
            : "mx-auto mb-12 hidden md:block"
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
              class={`note-stack-next border ${noteColorMap[stackColor].bg} ${noteColorMap[stackColor].border}`}
            >
              <div class="px-5 pt-12 pb-4 text-sm text-gray-400 dark:text-gray-300">
                {nextCta}
              </div>
            </div>
            <div
              class={`${topNoteClass} border ${noteColorMap[color].bg} ${noteColorMap[color].border}`}
            >
              <div class="px-5 pt-12 pb-4 text-sm text-gray-400 dark:text-gray-300">
                {topCta}
              </div>
            </div>
          </div>
          {/* Stack base — visible thickness at bottom */}
          <div class={`note-stack-base ${noteColorMap[stackColor].bg}`} />
        </div>
      </div>

      {/* Mobile FAB — opens the same create-note modal as the stack */}
      {!expanded && (
        <button
          type="button"
          class="md:hidden fixed bottom-5 right-5 z-10 w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-lg flex items-center justify-center transition-colors"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          onClick={openModal}
          aria-label={t("nav.newNote")}
        >
          <Plus class="w-7 h-7" />
        </button>
      )}

      {expanded &&
        createPortal(
          <>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
            <div
              class={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"}`}
              role="presentation"
              onClick={closeModal}
              onKeyDown={() => {}}
            />
            <div
              class={`fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
            >
              <div class="pointer-events-auto w-full max-w-2xl max-h-full overflow-y-auto overscroll-contain">
                <NoteEditor
                  title={title}
                  onTitleChange={setTitle}
                  content={content}
                  onContentChange={setContent}
                  color={color}
                  onColorChange={setColor}
                  font={font}
                  onFontChange={setFont}
                  images={images}
                  onAddImages={(urls) => setImages([...images, ...urls])}
                  onRemoveImage={(index) =>
                    setImages(images.filter((_, i) => i !== index))
                  }
                  linkPreviews={linkPreviews}
                  onAddLinkPreview={(url) => {
                    setLinkPreviews((prev) => {
                      if (prev.some((p) => p.url === url)) return prev;
                      return [...prev, makeStubPreview(url)];
                    });
                  }}
                  onRemoveLinkPreview={(index) =>
                    setLinkPreviews(linkPreviews.filter((_, i) => i !== index))
                  }
                  pinned={pinned}
                  onPinToggle={() => setPinned(!pinned)}
                  tags={tags}
                  onAddTag={(tag) => {
                    if (!tags.includes(tag)) {
                      setTags([...tags, tag]);
                    }
                  }}
                  onRemoveTag={(tag) => setTags(tags.filter((t) => t !== tag))}
                  onExportMarkdown={() =>
                    downloadNoteAsMarkdown({ title, content })
                  }
                  onExportJson={() => {
                    const now = new Date().toISOString();
                    const draft: Note = {
                      id: ulid(),
                      title,
                      content,
                      color,
                      font,
                      pinned,
                      archived: false,
                      trashed: false,
                      trashedAt: null,
                      position: 0,
                      tags,
                      images,
                      linkPreviews,
                      reminder: null,
                      createdAt: now,
                      updatedAt: now,
                    };
                    downloadNoteAsJson(draft);
                  }}
                  onDone={closeModal}
                  onDelete={discardNote}
                  deleteLabel={t("editor.discard")}
                />
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
