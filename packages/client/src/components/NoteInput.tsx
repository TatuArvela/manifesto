import type { NoteColor } from "@manifesto/shared";
import { Plus } from "lucide-preact";
import type { RefObject } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { ulid } from "ulid";
import { noteColorMap } from "#/colors.ts";
import { useColumnWidth } from "#/hooks/useColumnWidth.ts";
import { useComposerFields } from "#/hooks/useComposerFields.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { holdFocus, useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { type MessageKey, t } from "#/i18n/index.ts";
import { inlineImages, inlinePreviewImages } from "#/state/attachments.ts";
import {
  type ComposerDraft,
  clearDraft,
  isEmptyDraft,
  loadDraft,
  saveDraft,
} from "#/state/composerDraft.ts";
import { type IncomingShare, incomingShare } from "#/state/incomingShare.ts";
import {
  animations,
  defaultNoteColor,
  defaultNoteFont,
  noteQuips,
  noteSize,
  pickDefaultColor,
  pickDefaultFont,
  viewMode,
} from "#/state/prefs.ts";
import { activeView, newNoteRequested, showError } from "#/state/ui.ts";
import { queueNote } from "#/state/unsentNotes.ts";
import { extractUrls } from "#/utils/linkPreview.ts";
import {
  isMorphSource,
  morphIn,
  type RectLike,
  viewportSize,
} from "#/utils/morph.ts";
import {
  downloadNoteAsJson,
  downloadNoteAsMarkdown,
} from "#/utils/noteDownload.ts";
import { Backdrop } from "./Backdrop.tsx";
import { checklistSubmenu, downloadSubmenu } from "./card/noteMenuItems.tsx";
import { useEditor } from "./editor/lazyEditor.ts";
import { gridColumns } from "./gridColumns.ts";
import { NoteSheet } from "./NoteSheet.tsx";

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
 * How long the sheet takes to come off the pad. The editor waits for all of it,
 * and then grows out of the sheet. Thus, this is also the delay before you can
 * type.
 */
const LIFT_MS = 280;
/** The fade-out of the editor. */
const CLOSE_MS = 150;
function randomCta(exclude?: string): string {
  const all = ctaKeys.map((k) => t(k));
  const pool = exclude ? all.filter((m) => m !== exclude) : all;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

/**
 * The lines on the top sheet of the pad and on the sheet behind it. `cycle`
 * moves the next line up, and draws a new line behind it.
 */
function useQuips(): { top: string; next: string; cycle: () => void } {
  const [top, setTop] = useState(() => randomCta());
  const [next, setNext] = useState(() => randomCta(top));
  // The quips come from the rotation only while the preference is on. When it
  // is off, both sheets show the same plain line, and nothing rotates. The code
  // reads it at render, not when it selects a line. Thus, the toggle applies to
  // the stack that is already on the screen.
  const plain = noteQuips.value ? null : t("cta.plain");
  return {
    top: plain ?? top,
    next: plain ?? next,
    cycle: () => {
      setTop(next);
      setNext(randomCta(next));
    },
  };
}

/**
 * Downloads the unsaved contents of the composer as the JSON of a note. The
 * file contains the image bytes, not references that only this browser or
 * server can read.
 */
async function downloadDraftAsJson(draft: ComposerDraft): Promise<void> {
  const inlined = await inlineImages(draft.images);
  if (!inlined) {
    showError(t("error.exportFailed"));
    return;
  }
  const { imageAlts, linkPreviews, ...fields } = draft;
  const now = new Date().toISOString();
  downloadNoteAsJson({
    ...fields,
    id: ulid(),
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    images: inlined,
    ...(imageAlts.length > 0 && { imageAlts }),
    linkPreviews: await inlinePreviewImages(linkPreviews),
    reminder: null,
    createdAt: now,
    updatedAt: now,
  });
}

export function NoteInput() {
  const [expanded, setExpanded] = useState(false);
  const composer = useComposerFields(pickDefaultColor, pickDefaultFont);
  const { title, content, color, font, pinned, tags, images, imageAlts } =
    composer.fields;
  const drafts = composer.linkPreviews;
  const linkPreviews = drafts.previews;
  const [stackColor, setStackColor] = useState<NoteColor>(color);
  const [closing, setClosing] = useState(false);
  const [lifting, setLifting] = useState(false);
  const quips = useQuips();
  const focusCatcherRef = useRef<HTMLInputElement>(null);
  const topSheetRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The element out of which the editor grows, measured when the request to
  // open comes, and used after the layout of the panel. `opaque` for the peeled
  // sheet, which is gone when the editor takes its place.
  const morphFromRef = useRef<{ rect: RectLike; opaque: boolean } | null>(null);
  const [morphing, setMorphing] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // If the kept draft was read since the editor opened. Until then, the content
  // of the editor is not written over it. An editor that just opened is empty,
  // and would clear the draft that it must show.
  const [draftRead, setDraftRead] = useState(false);
  // The opening to which a draft that arrives belongs.
  const openingRef = useRef(0);
  // Increased when a kept draft goes in, to build the editor again around it.
  // The editor takes its text when it is built, and follows only itself after
  // that.
  const [filled, setFilled] = useState(0);

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

  // The sheet waits for the editor, because it grows out of the pad with the
  // editor inside. `expanded` means that it was asked for. `open` means that it
  // is up.
  const editor = useEditor(expanded, () => {
    focusCatcherRef.current?.blur();
    reset();
    setMorphing(false);
    setExpanded(false);
    showError(t("error.viewUnavailable"));
  });
  const open = expanded && editor !== null;

  const modalRef = useFocusTrap<HTMLDivElement>(open && !closing);

  // Layout, not effect. Thus, the first frame of the panel is already over its
  // source.
  useLayoutEffect(() => {
    const from = morphFromRef.current;
    const panel = panelRef.current;
    if (!open || !from || !panel) return;
    morphFromRef.current = null;
    morphIn(panel, from.rect, { opaque: from.opaque });
  }, [open]);

  // Select the colors again when the setting of the default note color changes.
  const colorSetting = defaultNoteColor.value;
  useEffect(() => {
    const c = pickDefaultColor();
    composer.update({ color: c });
    setStackColor(c);
  }, [colorSetting, composer.update]);

  // Select the font again when the setting of the default note font changes.
  const fontSetting = defaultNoteFont.value;
  useEffect(() => {
    composer.update({ font: pickDefaultFont() });
  }, [fontSetting, composer.update]);

  const isList = viewMode.value === "list";
  const isActiveView = activeView.value === "active";
  const column = useColumnWidth(!isList && isActiveView);

  const reset = () => {
    setDraftRead(false);
    composer.reset(stackColor, pickDefaultFont());
  };

  /** Puts a kept draft into the editor. */
  const fill = (draft: ComposerDraft) => {
    composer.fill(draft);
    setFilled((n) => n + 1);
  };

  /**
   * Reads the kept draft into the editor when it opens. `incoming` is a note
   * shared to the app, which takes the editor in place of the draft. A kept
   * draft is then saved as a separate note. It is not written over.
   */
  const readDraft = (incoming = false) => {
    const opening = ++openingRef.current;
    void loadDraft().then((kept) => {
      if (opening !== openingRef.current) return;
      if (kept && incoming) void queueNote(kept);
      else if (kept) fill(kept);
      setDraftRead(true);
    });
  };

  /** Opens the editor over `rect`. It grows out of it if it is visible. */
  const expandFrom = (rect: RectLike | undefined, opaque: boolean) => {
    const from = isMorphSource(rect, viewportSize()) ? rect : null;
    morphFromRef.current = from ? { rect: from, opaque } : null;
    setMorphing(from !== null);
    setExpanded(true);
  };

  /**
   * Opens the editor for a new note. From the pad, the top sheet comes off
   * first, and only when it is free does the editor grow out of it. From the
   * button of the phone, the editor grows out of the button.
   */
  const openModal = (source: "pad" | "button") => {
    // iOS Safari opens the soft keyboard only when .focus() runs synchronously
    // inside a user gesture. The autoFocus of MilkdownEditor runs in a
    // useEffect after editor.create() resolves, long after the gesture ends,
    // which is too late for iOS. Thus, focus a hidden input now. iOS opens the
    // keyboard, and the later move of focus to the editor keeps it open.
    // Through `holdFocus`. Thus, the focus trap does not take focus off it, and
    // does not give focus back to it.
    holdFocus(focusCatcherRef.current);
    setStackColor(pickDefaultColor());
    readDraft();
    // With motion off, there is nothing to wait for or grow out of.
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
      // Measured while the sheet still has its lifted pose, where the eye is.
      // The same render that opens the editor hides the sheet.
      expandFrom(topSheetRef.current?.getBoundingClientRect(), true);
      setLifting(false);
    });
  };

  /** Fades the editor out, and gives the pad back to the stack. */
  const finishClose = () => {
    setClosing(true);
    // The sheet shows opaque, in the same tick in which the CTA cycles onto it.
    // The sheet behind the peeled sheet already showed that same CTA, in
    // exactly the same place. Thus, you cannot see the change to the top sheet.
    // When the sheet faded in, the sheet behind it, which then had a different
    // CTA, showed through the transparent sheet.
    quips.cycle();
    after(CLOSE_MS, () => {
      reset();
      setClosing(false);
      setExpanded(false);
    });
  };

  /**
   * Saves the draft and closes. An empty draft becomes a note only when
   * `keepEmpty` says that the user pushed Done, which asks for one. Escape, the
   * backdrop and the back arrow are also how a person who opened the pad
   * accidentally gets out again. A save there would leave a blank note each
   * time.
   */
  const closeModal = (keepEmpty = false) => {
    // A snapshot at the time of the call. The 150ms close animation makes a
    // window in which a final markdownUpdated of Milkdown (fired on blur) can
    // arrive after this. If the code read the captured state inside the
    // timeout, it would lose that last edit. Thus, save synchronously now, and
    // animate the unmount after.
    const draft = composer.draft();
    const snap = {
      ...draft,
      title: draft.title.trim(),
      content: draft.content.trim(),
    };
    if (
      keepEmpty ||
      snap.title ||
      snap.content ||
      snap.images.length > 0 ||
      snap.linkPreviews.length > 0
    ) {
      void queueNote(snap, drafts.takePending());
    } else {
      void drafts.takePending();
    }
    // After the note is in the queue, which keeps it. Nothing is between the
    // two.
    openingRef.current++;
    void clearDraft();
    finishClose();
  };

  const discardNote = () => {
    void drafts.takePending();
    openingRef.current++;
    void clearDraft();
    finishClose();
  };

  const openNew = () =>
    openModal(topSheetRef.current?.getClientRects().length ? "pad" : "button");
  const openShare = (incoming: IncomingShare) => {
    composer.update({
      title: incoming.title,
      content: incoming.content,
      images: incoming.images,
      imageAlts: [],
    });
    drafts.add(extractUrls(incoming.content));
    readDraft(true);
    // No gesture to grow out of: the app just opened for this.
    setMorphing(false);
    setExpanded(true);
  };
  // The effects below read this when a request arrives. Thus, they do not have
  // to run again each time the handlers are built again.
  const openersRef = useRef({ openNew, openShare });
  openersRef.current = { openNew, openShare };

  // The draft is kept while it changes. Thus, a page that the system stops
  // loses none of it.
  useEffect(() => {
    if (!expanded || closing || !draftRead) return;
    const draft: ComposerDraft = { ...composer.fields, linkPreviews };
    if (isEmptyDraft(draft)) void clearDraft();
    else saveDraft(draft);
  }, [expanded, closing, draftRead, composer.fields, linkPreviews]);

  // Escape closes the editor, and saves, as a click outside does. All layers
  // opened from inside the editor register later, and take the key first.
  useEscapeStack(expanded, () => closeModal());

  // Something that a different app shared to the installed app opens here as a
  // new note.
  const share = incomingShare.value;
  useEffect(() => {
    if (!share || !isActiveView || expanded) return;
    incomingShare.value = null;
    openersRef.current.openShare(share);
  }, [share, isActiveView, expanded]);

  // The `c` shortcut: a new note from the pad where it shows, as a click on it
  // would open one.
  const newNote = newNoteRequested.value;
  useEffect(() => {
    if (!newNote || !isActiveView) return;
    newNoteRequested.value = false;
    if (!expanded) openersRef.current.openNew();
  }, [newNote, isActiveView, expanded]);

  // All hooks are above this line. `App` keeps this mounted in views where it
  // shows nothing. Thus, the same hooks must also run in those views.
  if (!isActiveView) return null;

  const topNoteHidden = lifting || (open && !closing);
  const topNoteClass = lifting
    ? "note-stack-top note-lift-off"
    : topNoteHidden
      ? "note-stack-top note-hidden"
      : "note-stack-top";
  // While it peels, the sheet still shows the color that you edit. The pad
  // under it already has a new color. In all other cases, the sheet is the pad.
  // Thus, it must not wait for `reset()` to get the new color.
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
          ref={column.rulerRef}
          class={`grid ${gridColumns()} gap-x-4 h-0 overflow-hidden pointer-events-none`}
          aria-hidden="true"
        >
          <div />
        </div>
      )}
      <ComposerPad
        isList={isList}
        width={column.width}
        stackColor={stackColor}
        topColor={topSheetColor}
        topClass={topNoteClass}
        topLine={quips.top}
        nextLine={quips.next}
        topSheetRef={topSheetRef}
        onOpen={() => !expanded && !lifting && openModal("pad")}
      />

      {/* Mobile FAB: opens the same create-note modal as the stack */}
      {!expanded && (
        <button
          ref={fabRef}
          type="button"
          class="md:hidden fixed right-5 z-20 w-14 h-14 rounded-2xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-lg flex items-center justify-center transition-colors"
          style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}
          onClick={() => openModal("button")}
          aria-label={t("nav.newNote")}
        >
          <Plus class="w-7 h-7" />
        </button>
      )}

      {open && (
        <NoteSheet
          label={t("nav.newNote")}
          dialogRef={modalRef}
          panelRef={panelRef}
          layer="layer-sheet"
          motion={`transition-all duration-150 ${closing ? "opacity-0 sm:scale-95" : morphing ? "" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
          backdrop={
            <Backdrop
              onDismiss={() => closeModal()}
              closing={closing}
              class="layer-backdrop max-sm:hidden"
            />
          }
          closing={closing}
          onBack={() => closeModal()}
        >
          <editor.NoteEditor
            key={filled}
            title={title}
            onTitleChange={(value) => composer.update({ title: value })}
            content={content}
            onContentChange={(value) => composer.update({ content: value })}
            color={color}
            onColorChange={(value) => composer.update({ color: value })}
            font={font}
            onFontChange={(value) => composer.update({ font: value })}
            images={images}
            imageAlts={imageAlts}
            onAddImages={composer.addImages}
            onRemoveImage={composer.removeImage}
            onDescribeImage={composer.describeImage}
            linkPreviews={linkPreviews}
            onAddLinkPreviews={drafts.add}
            onRemoveLinkPreview={drafts.remove}
            pinned={pinned}
            onPinToggle={() => composer.update({ pinned: !pinned })}
            tags={tags}
            onAddTag={composer.addTag}
            onRemoveTag={composer.removeTag}
            menuItems={({ checkedItems, datedItems }) => [
              checklistSubmenu({ checkedItems, datedItems }),
              { kind: "divider", id: "send" },
              downloadSubmenu({
                markdown: () => downloadNoteAsMarkdown({ title, content }),
                json: () => downloadDraftAsJson(composer.draft()),
              }),
            ]}
            onDone={() => closeModal(true)}
            onBack={() => closeModal()}
            onDelete={discardNote}
            deleteLabel={t("editor.discard")}
          />
        </NoteSheet>
      )}
    </>
  );
}

/**
 * The pad of notes from which the composer opens on a wide screen: the top
 * sheet, the sheet behind it that shows the next line, and the base of the
 * stack.
 */
function ComposerPad({
  isList,
  width,
  stackColor,
  topColor,
  topClass,
  topLine,
  nextLine,
  topSheetRef,
  onOpen,
}: {
  isList: boolean;
  width: number | undefined;
  stackColor: NoteColor;
  topColor: NoteColor;
  topClass: string;
  topLine: string;
  nextLine: string;
  topSheetRef: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
}) {
  return (
    // Slides in and out when the Notes view comes and goes. It does not fade
    // with the other content (hooks/useViewTransition.ts).
    <div
      data-view-slide="composer"
      class={
        isList
          ? noteSize.value === "square"
            ? "max-w-sm mx-auto mb-12 hidden md:block"
            : "mb-12 hidden md:block"
          : "mx-auto mb-12 hidden md:block"
      }
      style={!isList && width ? { width: `${width}px` } : undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: styled card element */}
      <div
        class="note-stack cursor-pointer"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
      >
        {/* Notes area: top note + next note behind it */}
        <div class="relative">
          <div
            class={`note-stack-next border ${noteColorMap[stackColor].bg} ${noteColorMap[stackColor].border}`}
          >
            <div class="px-5 pt-12 pb-4 text-sm text-neutral-500 dark:text-neutral-300">
              {nextLine}
            </div>
          </div>
          <div
            ref={topSheetRef}
            class={`${topClass} border ${noteColorMap[topColor].bg} ${noteColorMap[topColor].border}`}
          >
            <div class="px-5 pt-12 pb-4 text-sm text-neutral-500 dark:text-neutral-300">
              {topLine}
            </div>
          </div>
        </div>
        <div class={`note-stack-base ${noteColorMap[stackColor].bg}`} />
      </div>
    </div>
  );
}
