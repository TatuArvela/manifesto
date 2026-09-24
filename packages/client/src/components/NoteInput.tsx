import type { Note, NoteColor, NoteFont } from "@manifesto/shared";
import { Braces, FileText, ListX, Plus } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ulid } from "ulid";
import { noteColorMap } from "../colors.js";
import { useDraftLinkPreviews } from "../hooks/useDraftLinkPreviews.js";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { holdFocus, useFocusTrap } from "../hooks/useFocusTrap.js";
import { type MessageKey, t } from "../i18n/index.js";
import { inlineImages, inlinePreviewImages } from "../state/attachments.js";
import { type IncomingShare, incomingShare } from "../state/incomingShare.js";
import {
  activeView,
  animations,
  applyLinkPreviews,
  createNote,
  defaultNoteColor,
  defaultNoteFont,
  newNoteRequested,
  noteQuips,
  noteSize,
  pickDefaultColor,
  pickDefaultFont,
  showError,
  viewMode,
} from "../state/index.js";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "../utils/importExport.js";
import { extractUrls } from "../utils/linkPreview.js";
import {
  isMorphSource,
  morphIn,
  type RectLike,
  viewportSize,
} from "../utils/morph.js";
import { Backdrop } from "./Backdrop.js";
import { gridColumns } from "./gridColumns.js";
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

/**
 * How long the sheet takes to come off the pad. The editor waits for all of
 * it and then grows out of the sheet, so this is also the delay before typing.
 */
const LIFT_MS = 280;
/** Editor fade-out. */
const CLOSE_MS = 150;
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
  const drafts = useDraftLinkPreviews();
  const linkPreviews = drafts.previews;
  const [closing, setClosing] = useState(false);
  const [lifting, setLifting] = useState(false);
  const [topCta, setTopCta] = useState(() => randomCta());
  const [nextCta, setNextCta] = useState(() => randomCta(topCta));
  // The quips are drawn from the rotation only while the preference is on;
  // with it off both sheets read the same plain line, so nothing rotates.
  // Read at render rather than at pick time, so the toggle takes effect on the
  // stack that is already on screen.
  const topLine = noteQuips.value ? topCta : t("cta.plain");
  const nextLine = noteQuips.value ? nextCta : t("cta.plain");
  const focusCatcherRef = useRef<HTMLInputElement>(null);
  const topSheetRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // What the editor grows out of, measured as it is asked to open and used
  // once the panel is laid out. `opaque` for the peeled sheet, which is gone
  // the moment the editor takes over from it.
  const morphFromRef = useRef<{ rect: RectLike; opaque: boolean } | null>(null);
  const [morphing, setMorphing] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const after = (ms: number, fn: () => void) => {
    timersRef.current.push(setTimeout(fn, ms));
  };

  useEffect(
    () => () => {
      for (const t of timersRef.current) clearTimeout(t);
      timersRef.current = [];
    },
    [],
  );

  const modalRef = useFocusTrap<HTMLDivElement>(expanded && !closing);

  // Layout, not effect, so the panel's first frame is already over its source.
  useLayoutEffect(() => {
    const from = morphFromRef.current;
    const panel = panelRef.current;
    if (!expanded || !from || !panel) return;
    morphFromRef.current = null;
    morphIn(panel, from.rect, { opaque: from.opaque });
  }, [expanded]);

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

  const isList = viewMode.value === "list";
  const isActiveView = activeView.value === "active";
  const rulerRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState<number | undefined>(undefined);

  // Layout effect, not an effect: the stack has no width of its own until this
  // runs, so measuring after paint leaves it stretched across the whole column
  // area for a frame, very visible on leaving the search view, which remounts
  // this component with the width unknown again. A zero reading is ignored
  // rather than applied: the ruler measures nothing while this view is not the
  // active one, and 0px would collapse the stack when it comes back.
  //
  // Keyed on the view as well. `App` keeps this mounted in the archive, trash
  // and reminders views, where it renders nothing and there is no ruler to
  // measure; mounted in one of those (arriving from tags, say, which unmounts
  // it), it came back to the notes view with the width never measured and
  // stretched across the whole column area until the next resize.
  useLayoutEffect(() => {
    if (isList || !isActiveView) return;
    const ruler = rulerRef.current;
    if (!ruler) return;
    const cell = ruler.firstElementChild as HTMLElement;
    if (!cell) return;
    const measure = () => {
      const width = cell.getBoundingClientRect().width;
      if (width > 0) setColWidth(width);
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(ruler);
    // The cell too: switching to small notes changes the column count, which
    // narrows the cell while the ruler keeps its width.
    obs.observe(cell);
    return () => obs.disconnect();
  }, [isList, isActiveView]);

  /** The unsaved composer contents, shaped as a note for the JSON export. */
  const draftNote = (): Note => {
    const now = new Date().toISOString();
    return {
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
  };

  const reset = () => {
    setTitle("");
    setContent("");
    setColor(stackColor);
    setFont(pickDefaultFont());
    setPinned(false);
    setTags([]);
    setImages([]);
    drafts.clear();
  };

  const cycleCta = () => {
    setTopCta(nextCta);
    setNextCta(randomCta(nextCta));
  };

  /** Opens the editor over `rect`, growing out of it if it can be seen. */
  const expandFrom = (rect: RectLike | undefined, opaque: boolean) => {
    const from = isMorphSource(rect, viewportSize()) ? rect : null;
    morphFromRef.current = from ? { rect: from, opaque } : null;
    setMorphing(from !== null);
    setExpanded(true);
  };

  /**
   * Opens the editor for a new note. From the pad, the top sheet is pulled
   * off first, and only once it is free does the editor grow out of it; from
   * the phone's button, the editor grows out of the button.
   */
  const openModal = (source: "pad" | "button") => {
    // iOS Safari only opens the soft keyboard when .focus() runs synchronously
    // inside a user gesture. MilkdownEditor's autoFocus runs in a useEffect
    // after editor.create() resolves, well after the gesture ends, too late
    // for iOS. Pre-focus a hidden input now; iOS opens the keyboard, and the
    // later focus transfer to the editor keeps it up. Through `holdFocus`, so
    // the focus trap neither takes focus off it nor gives focus back to it.
    holdFocus(focusCatcherRef.current);
    setStackColor(pickDefaultColor());
    // With motion off there is nothing to wait for or grow out of.
    if (!animations.value) {
      setMorphing(false);
      setExpanded(true);
      return;
    }
    if (source === "button") {
      expandFrom(fabRef.current?.getBoundingClientRect(), false);
      return;
    }
    setLifting(true);
    after(LIFT_MS, () => {
      // Measured while the sheet still holds its lifted pose, which is where
      // the eye is; the same render that opens the editor hides the sheet.
      expandFrom(topSheetRef.current?.getBoundingClientRect(), true);
      setLifting(false);
    });
  };

  /** Fades the editor out and hands the pad back to the stack. */
  const finishClose = () => {
    setClosing(true);
    // The sheet is revealed opaque, in the same tick the CTA cycles onto it.
    // The sheet behind the peeled one has been showing that very CTA all along
    // and sits in exactly the same place, so the top sheet taking over is
    // invisible. Fading it in instead made the sheet behind it, which by then
    // carries a different CTA, ghost through the transparent one.
    cycleCta();
    after(CLOSE_MS, () => {
      reset();
      setClosing(false);
      setExpanded(false);
    });
  };

  /**
   * Saves the draft and closes. An empty draft becomes a note only when
   * `keepEmpty` says the user pressed Done, which asks for one. Escape, the
   * backdrop and the back arrow are also how someone who opened the pad by
   * accident gets out again, and saving there would leave a blank note behind
   * every time.
   */
  const closeModal = (keepEmpty = false) => {
    // Snapshot at call time. The 150ms close animation creates a window where
    // a final Milkdown markdownUpdated (fired on blur) can land after this,
    // and reading the closure-captured state inside the timeout would drop
    // that last edit. Save synchronously now, animate the unmount after.
    const snap = {
      title: title.trim(),
      content: content.trim(),
      color,
      font,
      pinned,
      tags,
      images,
      linkPreviews,
    };
    if (
      keepEmpty ||
      snap.title ||
      snap.content ||
      snap.images.length > 0 ||
      snap.linkPreviews.length > 0
    ) {
      const pending = drafts.takePending();
      createNote(snap).then((note) => {
        if (note && pending.length > 0) applyLinkPreviews(note.id, pending);
      });
    } else {
      drafts.takePending();
    }
    finishClose();
  };

  const discardNote = () => {
    drafts.takePending();
    finishClose();
  };

  const openNew = () =>
    openModal(topSheetRef.current?.getClientRects().length ? "pad" : "button");
  const openShare = (incoming: IncomingShare) => {
    setTitle(incoming.title);
    setContent(incoming.content);
    setImages(incoming.images);
    drafts.add(extractUrls(incoming.content));
    // No gesture to grow out of: the app has just been opened for this.
    setMorphing(false);
    setExpanded(true);
  };

  // Escape closes the editor, saving as clicking outside does. Anything
  // opened from inside the editor registers later and takes the key first.
  useEscapeStack(expanded, () => closeModal());

  // Something shared to the installed app from elsewhere opens here as a new
  // note.
  const share = incomingShare.value;
  useEffect(() => {
    if (!share || !isActiveView || expanded) return;
    incomingShare.value = null;
    openShare(share);
  }, [share, isActiveView, expanded]);

  // The `c` shortcut: a new note, from the pad where it shows, as a click on it
  // would open one.
  const newNote = newNoteRequested.value;
  useEffect(() => {
    if (!newNote || !isActiveView) return;
    newNoteRequested.value = false;
    if (!expanded) openNew();
  }, [newNote, isActiveView, expanded]);

  // Every hook is above this line: `App` keeps this mounted in views where it
  // shows nothing, so the same hooks must run in those too.
  if (!isActiveView) return null;

  const topNoteHidden = lifting || (expanded && !closing);
  const topNoteClass = lifting
    ? "note-stack-top note-lift-off"
    : topNoteHidden
      ? "note-stack-top note-hidden"
      : "note-stack-top";
  // While peeling, the sheet still shows the colour being edited; the pad
  // underneath has already been re-picked. Everywhere else the sheet is the
  // pad, so it must not wait for `reset()` to catch the new colour up.
  const topSheetColor = lifting ? color : stackColor;

  return (
    <>
      {/* iOS Safari keyboard primer; see openModal() */}
      <input
        ref={focusCatcherRef}
        type="text"
        tabIndex={-1}
        aria-hidden="true"
        class="fixed top-0 left-0 w-px h-px opacity-0 pointer-events-none"
      />
      {/* Hidden ruler to measure one grid column width */}
      {!isList && (
        <div
          ref={rulerRef}
          class={`grid ${gridColumns()} gap-x-4 h-0 overflow-hidden pointer-events-none`}
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
          onClick={() => !expanded && !lifting && openModal("pad")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !expanded && !lifting) openModal("pad");
          }}
        >
          {/* Notes area: top note + next note behind it */}
          <div class="relative">
            <div
              class={`note-stack-next border ${noteColorMap[stackColor].bg} ${noteColorMap[stackColor].border}`}
            >
              <div class="px-5 pt-12 pb-4 text-sm text-neutral-400 dark:text-neutral-300">
                {nextLine}
              </div>
            </div>
            <div
              ref={topSheetRef}
              class={`${topNoteClass} border ${noteColorMap[topSheetColor].bg} ${noteColorMap[topSheetColor].border}`}
            >
              <div class="px-5 pt-12 pb-4 text-sm text-neutral-400 dark:text-neutral-300">
                {topLine}
              </div>
            </div>
          </div>
          <div class={`note-stack-base ${noteColorMap[stackColor].bg}`} />
        </div>
      </div>

      {/* Mobile FAB: opens the same create-note modal as the stack */}
      {!expanded && (
        <button
          ref={fabRef}
          type="button"
          class="md:hidden fixed right-5 z-10 w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-lg flex items-center justify-center transition-colors"
          style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          onClick={() => openModal("button")}
          aria-label={t("nav.newNote")}
        >
          <Plus class="w-7 h-7" />
        </button>
      )}

      {expanded &&
        createPortal(
          <>
            <Backdrop
              onDismiss={() => closeModal()}
              closing={closing}
              class="z-40 max-sm:hidden"
            />
            <div
              ref={modalRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("nav.newNote")}
              class={`fixed inset-0 z-50 flex items-center justify-center sm:p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 sm:scale-95" : morphing ? "" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
            >
              <div
                ref={panelRef}
                class="pointer-events-auto w-full sm:max-w-2xl sm:max-h-full sm:overflow-y-auto sm:overscroll-contain max-sm:h-full max-sm:overflow-hidden"
              >
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
                  onAddLinkPreviews={drafts.add}
                  onRemoveLinkPreview={drafts.remove}
                  pinned={pinned}
                  onPinToggle={() => setPinned(!pinned)}
                  tags={tags}
                  onAddTag={(tag) =>
                    setTags((current) =>
                      current.includes(tag) ? current : [...current, tag],
                    )
                  }
                  onRemoveTag={(tag) => setTags(tags.filter((t) => t !== tag))}
                  menuItems={({ checkedItems }) => [
                    {
                      id: "export-markdown",
                      icon: <FileText class="w-4 h-4" />,
                      label: t("noteMenu.exportMarkdown"),
                      onSelect: () =>
                        downloadNoteAsMarkdown({ title, content }),
                    },
                    {
                      id: "export-json",
                      icon: <Braces class="w-4 h-4" />,
                      label: t("noteMenu.exportJson"),
                      onSelect: async () => {
                        // The file carries the bytes, not references only
                        // this browser or server can read.
                        const inlined = await inlineImages(images);
                        if (!inlined) {
                          showError(t("error.exportFailed"));
                          return;
                        }
                        downloadNoteAsJson({
                          ...draftNote(),
                          images: inlined,
                          linkPreviews: await inlinePreviewImages(linkPreviews),
                        });
                      },
                    },
                    { kind: "divider", id: "destructive" },
                    ...(checkedItems.present
                      ? [
                          {
                            id: "delete-checked",
                            icon: <ListX class="w-4 h-4" />,
                            label: t("noteMenu.deleteChecked"),
                            onSelect: checkedItems.remove,
                          } as const,
                        ]
                      : []),
                  ]}
                  onDone={() => closeModal(true)}
                  onBack={() => closeModal()}
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
