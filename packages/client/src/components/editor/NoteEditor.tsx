import type {
  LinkPreview,
  NoteColor,
  NoteFont,
  NoteReminder,
} from "@manifesto/shared";
import type { Editor } from "@milkdown/kit/core";
import type { ComponentChildren } from "preact";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "#/colors.ts";
import type { NoteMenuItem } from "#/components/card/NoteMenu.tsx";
import { ImageGallery, ImageLightbox } from "#/components/ImageGallery.tsx";
import { LinkPreviewList } from "#/components/LinkPreviewList.tsx";
import { PendingUploads } from "#/components/PendingUploads.tsx";
import { useEditorTicks } from "#/hooks/useEditorTicks.ts";
import { useHeldHeight } from "#/hooks/useHeldHeight.ts";
import { useMediaQuery } from "#/hooks/useMediaQuery.ts";
import { useNotePaste } from "#/hooks/useNotePaste.ts";
import { t } from "#/i18n/index.ts";
import { defaultEditMode, formattingToolbar } from "#/state/prefs.ts";
import { afterNextPaint } from "#/utils/afterPaint.ts";
import { imagesInText } from "#/utils/inlineImages.ts";
import { PHONE_QUERY } from "#/utils/phoneSheets.ts";
import {
  EditorChips,
  EditorTopBar,
  PlaceImageNotice,
} from "./EditorChrome.tsx";
import { FormattingToolbar } from "./FormattingToolbar.tsx";
import { MilkdownEditor } from "./MilkdownEditor.tsx";
import { HistoryButtons, NoteEditorToolbar } from "./NoteEditorToolbar.tsx";
import { textActions } from "./textActions.ts";
import { useTextImages } from "./useTextImages.tsx";

interface NoteEditorProps {
  title: string;
  onTitleChange: (value: string) => void;
  content: string;
  onContentChange: (value: string) => void;
  color: NoteColor;
  onColorChange: (color: NoteColor) => void;
  font: NoteFont;
  onFontChange: (font: NoteFont) => void;
  images: string[];
  /** What each image shows, in words, aligned with `images`. */
  imageAlts?: string[] | undefined;
  /** With `replaces`, in place of that image, not after the others. */
  onAddImages: (dataUrls: string[], replaces?: string) => void;
  /**
   * Pictures to attach when the editor opens, selected or drawn on the card.
   */
  initialFiles?: File[] | undefined;
  /**
   * Takes the image out of the list. `NoteEditor` changes the text itself
   * first: the pointers to the image go, and later pointers move down.
   */
  onRemoveImage: (index: number) => void;
  /** Not given where the images cannot get descriptions. */
  onDescribeImage?: ((image: string, alt: string) => void) | undefined;
  linkPreviews: LinkPreview[];
  /** All URLs from one paste, together. Thus, they go in one write. */
  onAddLinkPreviews: (urls: string[]) => void;
  onRemoveLinkPreview: (index: number) => void;
  pinned: boolean;
  onPinToggle: () => void;
  tags: string[];
  /** Called with a normalized tag that the note does not have yet. */
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  reminder?: NoteReminder | null;
  onReminderChange?: (reminder: NoteReminder | null) => void;
  onDone: () => void;
  /** The back arrow of the phone. The default is `onDone`. */
  onBack?: () => void;
  disabled?: boolean;
  contentLocked?: boolean;
  /**
   * A line about the state of the note, shown between the title and the text.
   */
  notice?: ComponentChildren;
  metadata?: ComponentChildren;
  /**
   * The rows of the kebab menu. It is a builder, not a list, because two rows
   * belong to the document, not to the note. Only this component can know if
   * there are checked items to delete or items with dates to sort, and how to
   * do either, because in collab mode the shared document is the only copy that
   * counts.
   */
  menuItems?: (editorActions: {
    checkedItems: { present: boolean; remove: () => void; uncheck: () => void };
    datedItems: { present: boolean; sort: () => void };
  }) => NoteMenuItem[];
  /**
   * Discards an unsaved draft. Shown as a toolbar button, not as a menu row.
   */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Puts the caret in the text after the editor is built. On by default. */
  autoFocus?: boolean;
  /**
   * The editor instance, each time one is built (it is built again when
   * collaboration arrives).
   */
  onEditorReady?: (editor: Editor) => void;
  collab?:
    | {
        ydoc: import("yjs").Doc;
        fragmentName?: string;
        awareness?: import("y-protocols/awareness").Awareness | undefined;
      }
    | undefined;
}

/**
 * The height of the place of the formatting bar after its last paint, on a
 * phone and on a wider screen (the buttons of a phone are larger). 0 before
 * the first bar of the session.
 *
 * A new editor gives the place this height, and builds the bar only after its
 * first paint. The first frames of an opened note show its card, not its
 * controls (`utils/morphStandIn.ts`). The bar is a third of the elements of an
 * open note (107 of 295). Its render and their style moved the start of the
 * grow about 6 ms later. The place has the height of the bar from the first
 * frame. Thus, the panel that the grow measures does not change when the bar
 * comes. The first editor of a session has no height yet, and builds its bar
 * at once, as before.
 *
 * The height is on the place itself, not on a child in it: `useHeldHeight`
 * holds the place when a child of it goes, until the next editor.
 */
const barHeights = { phone: 0, wide: 0 };

export function NoteEditor({
  title,
  onTitleChange,
  content,
  onContentChange,
  color,
  onColorChange,
  font,
  onFontChange,
  images,
  imageAlts,
  onAddImages,
  initialFiles,
  onRemoveImage,
  onDescribeImage,
  linkPreviews,
  onAddLinkPreviews,
  onRemoveLinkPreview,
  pinned,
  onPinToggle,
  tags,
  onAddTag,
  onRemoveTag,
  reminder,
  onReminderChange,
  onDone,
  onBack,
  disabled,
  contentLocked,
  notice,
  metadata,
  menuItems,
  onDelete,
  deleteLabel,
  autoFocus = true,
  onEditorReady,
  collab,
}: NoteEditorProps) {
  // Read one time, when the editor opens. A change of the default during an
  // edit must not change a note that is already open.
  const [rawMode, setRawMode] = useState(
    () => defaultEditMode.peek() === "raw",
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  // The textarea is always mounted, only hidden. Thus, this is the one switch
  // for all parts that edit "the text of the note". In raw mode, that is the
  // textarea, and the rich editor behind it is built again from it on the way
  // back.
  const rawTextarea = rawMode ? rawTextareaRef.current : null;

  const {
    resolveInlineImage,
    pointAtCaret,
    uploads,
    attachFiles,
    retryUpload,
    dropUpload,
    drawOver,
    drawNew,
    removeImage,
    textEditable,
    placing,
    setPlacing,
    fullInText,
    setFullInText,
    inlineImageControls,
  } = useTextImages({
    images,
    imageAlts,
    editor,
    rawTextarea,
    content,
    onContentChange,
    onAddImages,
    onRemoveImage,
    onDescribeImage,
    disabled,
    contentLocked,
  });

  // A paste is in the text when it is inside the editor or the raw textarea,
  // and the text can change.
  const textRef = useRef<HTMLDivElement>(null);
  // The text and the formatting bar keep their height while the editor is
  // built again (solo to collab). See `useHeldHeight`.
  const toolbarSlotRef = useRef<HTMLDivElement>(null);
  useHeldHeight([textRef, toolbarSlotRef], editor);
  const isInText = useCallback(
    (target: EventTarget | null) =>
      !contentLocked &&
      target instanceof Node &&
      Boolean(textRef.current?.contains(target)),
    [contentLocked],
  );

  // Pictures selected or drawn on the card that opened this editor, attached
  // one time when it opens.
  const initialFilesRef = useRef(initialFiles);
  useEffect(() => {
    const files = initialFilesRef.current;
    initialFilesRef.current = undefined;
    if (files && files.length > 0) attachFiles(files);
  }, [attachFiles]);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = [...files].filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length > 0) attachFiles(imageFiles);
  };

  useNotePaste({ disabled, attachFiles, isInText, onAddLinkPreviews });
  // Controls the undo buttons and the active formats of the toolbar.
  const tick = useEditorTicks(editor, rawMode, rawTextareaRef);
  const actions = textActions(editor, rawMode, rawTextarea);

  const colors = noteColorMap[color];

  // On a phone, the tools go in the top bar, which stays on the screen, not
  // under the note, where the keyboard covers them. See `NoteEditorToolbar`.
  // Mounted in one place or the other, not both.
  const phone = useMediaQuery(PHONE_QUERY);

  // The formatting bar comes after the first paint with an editor
  // (`barHeights`). A note that closes before that paint cancels it.
  const [barHeight] = useState(() => barHeights[phone ? "phone" : "wide"]);
  const [barShown, setBarShown] = useState(barHeight === 0);
  useLayoutEffect(() => {
    if (barShown || !editor) return;
    return afterNextPaint(() => setBarShown(true));
  }, [barShown, editor]);
  // After a paint of the bar, when its layout is up to date. `offsetHeight`
  // and not the box on the screen: the panel is scaled while it grows. Without
  // the fold of a phone, which can be open now and is closed in a new bar.
  useLayoutEffect(() => {
    if (!barShown || !editor) return;
    const layout = phone ? "phone" : "wide";
    return afterNextPaint(() => {
      const slot = toolbarSlotRef.current;
      if (!slot) return;
      const fold = phone
        ? slot.querySelector<HTMLElement>("[data-toolbar-fold]")
        : null;
      const height = slot.offsetHeight - (fold?.offsetHeight ?? 0);
      if (height > 0) barHeights[layout] = height;
    });
  }, [barShown, editor, phone]);

  const toolbar = (
    <NoteEditorToolbar
      atTop={phone}
      color={color}
      onColorChange={onColorChange}
      font={font}
      onFontChange={onFontChange}
      tags={tags}
      onAddTag={onAddTag}
      reminder={reminder}
      onReminderChange={onReminderChange}
      onFilesSelected={handleFilesSelected}
      onDraw={drawNew}
      rawMode={rawMode}
      onToggleRawMode={() => setRawMode(!rawMode)}
      menuItems={
        menuItems?.({
          checkedItems: actions.checkedItems,
          datedItems: actions.datedItems,
        }) ?? []
      }
      canUndo={actions.canUndo}
      canRedo={actions.canRedo}
      onUndo={() => actions.runHistory("undo")}
      onRedo={() => actions.runHistory("redo")}
      onDelete={onDelete}
      deleteLabel={deleteLabel}
      onDone={onDone}
      disabled={disabled}
    />
  );

  return (
    <article
      class={`${colors.bg} ${colors.border} note-surface note-color-transition relative z-10 sm:border note-sheet-surface max-sm:flex max-sm:flex-col`}
    >
      <EditorTopBar
        pinned={pinned}
        onPinToggle={onPinToggle}
        onBack={onBack ?? onDone}
        disabled={disabled}
        history={
          phone && (
            <HistoryButtons
              canUndo={actions.canUndo}
              canRedo={actions.canRedo}
              onUndo={() => actions.runHistory("undo")}
              onRedo={() => actions.runHistory("redo")}
            />
          )
        }
      >
        {phone && toolbar}
      </EditorTopBar>

      {images.length > 0 && (
        <ImageGallery
          images={images}
          alts={imageAlts}
          hidden={imagesInText(content)}
          onDescribe={disabled ? undefined : onDescribeImage}
          onDelete={removeImage}
          onEdit={disabled ? undefined : drawOver}
          onPutInText={textEditable ? setPlacing : undefined}
        />
      )}
      {fullInText !== null && (
        <ImageLightbox
          images={images}
          alts={imageAlts}
          onDescribe={disabled ? undefined : onDescribeImage}
          describing={fullInText.describe}
          index={fullInText.index}
          onChangeIndex={(index) => setFullInText({ index, describe: false })}
          onClose={() => setFullInText(null)}
        />
      )}
      {uploads.length > 0 && (
        <PendingUploads
          uploads={uploads}
          onRetry={retryUpload}
          onRemove={dropUpload}
        />
      )}

      <div class="p-4 max-sm:px-4 max-sm:pt-2 max-sm:flex-1 max-sm:flex max-sm:flex-col">
        <input
          ref={titleRef}
          type="text"
          class="w-full bg-transparent outline-none font-medium text-base max-sm:text-[1.35rem] mb-2 placeholder:text-neutral-400 sm:pr-32"
          placeholder={t("editor.titlePlaceholder")}
          aria-label={t("editor.titlePlaceholder")}
          value={title}
          onInput={(e) => onTitleChange((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              actions.focusText("start");
            }
          }}
          disabled={disabled}
          style={{ fontFamily: noteFontFamilies[font] || undefined }}
        />

        {notice}

        {placing !== null && (
          <PlaceImageNotice
            onAtCaret={() => {
              pointAtCaret(placing);
              setPlacing(null);
            }}
            onCancel={() => setPlacing(null)}
          />
        )}

        {/* Shown or hidden for every note at once, from Settings. Its place
            keeps its height while the editor is built again, as the text
            does. `flow-root` keeps the margin of the bar inside it, so that the
            held height includes it. Until the bar comes, the place has the
            height that the bar had the last time (`barHeights`). */}
        {!disabled && !contentLocked && formattingToolbar.value && (
          <div
            ref={toolbarSlotRef}
            class="flow-root"
            style={barShown ? undefined : { height: `${barHeight}px` }}
          >
            {barShown && editor && (
              <FormattingToolbar
                editor={editor}
                rawTextarea={rawTextarea}
                tick={tick}
                disabled={disabled}
                onAddLink={(url) => onAddLinkPreviews([url])}
                images={images}
                imageAlts={imageAlts}
              />
            )}
          </div>
        )}

        {/* Grows to fill a short note's screen, so a tap below the text
            still lands in it, but never shrinks below the text: the column
            around it is what scrolls, and a wrapper shorter than its text
            lets the text run over the timestamps and tags under it. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: padding-area focus forward; inner contentEditable is the real target */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users tab into the inner contentEditable directly */}
        <div
          ref={textRef}
          class={`max-sm:flex-1 max-sm:cursor-text ${placing !== null ? "[&_.ProseMirror]:cursor-crosshair [&_textarea]:cursor-crosshair" : ""}`}
          style={{ fontFamily: noteFontFamilies[font] || undefined }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            actions.focusText("end");
          }}
        >
          <MilkdownEditor
            // useMilkdownEditor builds one time on mount, and reads `collab` as
            // it is then. The provider always resolves after the first render.
            // Thus, without a remount here, the collab plugin is never
            // installed, and the editor silently stays solo.
            key={collab ? "collab" : "solo"}
            content={content}
            onChange={onContentChange}
            resolveInlineImage={resolveInlineImage}
            inlineImageControls={inlineImageControls}
            disabled={disabled}
            contentLocked={contentLocked}
            rawMode={rawMode}
            textareaRef={rawTextareaRef}
            autoFocus={autoFocus}
            onEditorReady={(instance) => {
              setEditor(instance);
              onEditorReady?.(instance);
            }}
            onEditorGone={() => setEditor(null)}
            // No bar comes. Thus, its place lets go of the height of the last
            // bar, which was empty above the text.
            onEditorFailed={() => setBarShown(true)}
            collab={collab}
          />
        </div>

        {metadata}

        {linkPreviews.length > 0 && (
          <div class="mt-3">
            <LinkPreviewList
              previews={linkPreviews}
              variant="editor"
              onRemove={onRemoveLinkPreview}
            />
          </div>
        )}

        <EditorChips
          tags={tags}
          onRemoveTag={onRemoveTag}
          reminder={reminder}
          onReminderChange={onReminderChange}
        />
      </div>

      {!phone && toolbar}
    </article>
  );
}
