import {
  isStoredImageRef,
  type LinkPreview,
  type NoteColor,
  type NoteFont,
  type NoteReminder,
  reminderDone,
} from "@manifesto/shared";
import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { ArrowLeft, Pin, PinOff } from "lucide-preact";
import { type ComponentChildren, render } from "preact";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "#/colors.ts";
import { buttonClass } from "#/components/buttonClasses.ts";
import type { NoteMenuItem } from "#/components/card/NoteMenu.tsx";
import {
  ImageButtons,
  ImageGallery,
  ImageLightbox,
} from "#/components/ImageGallery.tsx";
import { LinkPreviewList } from "#/components/LinkPreviewList.tsx";
import { PendingUploads } from "#/components/PendingUploads.tsx";
import { CARD_POPOVER_EXIT_MS, CardPopover } from "#/components/Popover.tsx";
import { ReminderChip } from "#/components/ReminderChip.tsx";
import { ReminderPickerPanel } from "#/components/ReminderPicker.tsx";
import { TagChip } from "#/components/TagChip.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import {
  placeImagePointer,
  removeImagePointers,
} from "#/extensions/imagePointers.ts";
import type { InlineImageControls } from "#/extensions/inlineImageView.ts";
import { applyFormat } from "#/extensions/richFormatting.ts";
import { useEditorTicks } from "#/hooks/useEditorTicks.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useImageUploads } from "#/hooks/useImageUploads.ts";
import { useMediaQuery } from "#/hooks/useMediaQuery.ts";
import { useNotePaste } from "#/hooks/useNotePaste.ts";
import { usePresence } from "#/hooks/usePresence.ts";
import { t } from "#/i18n/index.ts";
import { attachmentObjectUrl } from "#/state/attachments.ts";
import { closeDrawing, requestDrawing } from "#/state/drawing.ts";
import { defaultEditMode, formattingToolbar } from "#/state/prefs.ts";
import { imagesInText, withoutImagePointer } from "#/utils/inlineImages.ts";
import { PHONE_QUERY } from "#/utils/phoneSheets.ts";
import { applyRawFormat, applyTextEdit } from "#/utils/rawFormatting.ts";
import { editorButtonClass, editorIconClass } from "./editorButtons.ts";
import { FormattingToolbar } from "./FormattingToolbar.tsx";
import { MilkdownEditor } from "./MilkdownEditor.tsx";
import { HistoryButtons, NoteEditorToolbar } from "./NoteEditorToolbar.tsx";
import { textActions } from "./textActions.ts";

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

  // The images that the text points to (`utils/inlineImages.ts`). The editor
  // builds one time. Thus, it reads them through a ref.
  const imagesRef = useRef({ images, imageAlts });
  imagesRef.current = { images, imageAlts };
  const resolveInlineImage = useCallback(async (index: number) => {
    const { images: list, imageAlts: alts } = imagesRef.current;
    const image = list[index];
    if (image === undefined) return null;
    const src = isStoredImageRef(image)
      ? await attachmentObjectUrl(image)
      : image;
    return src ? { src, alt: alts?.[index] ?? "" } : null;
  }, []);

  // Puts a pointer to image `index` (from 0) at the caret, or over the
  // selection, of the text that is on the screen.
  const pointAtCaret = useCallback(
    (index: number) => {
      const pointer = String(index + 1);
      if (rawTextarea) {
        const edit = applyRawFormat(
          rawTextarea.value,
          rawTextarea.selectionStart,
          rawTextarea.selectionEnd,
          "inlineImage",
          pointer,
        );
        if (edit) applyTextEdit(rawTextarea, edit);
      } else if (editor) {
        applyFormat(editor, "inlineImage", pointer);
      }
    },
    [editor, rawTextarea],
  );

  // A stored image that a paste put in the text waits here until it is in
  // `images`. Only then does it have the index that its pointer names.
  const toText = useRef<string[]>([]);
  const { uploads, attachFiles, retryUpload, dropUpload } = useImageUploads(
    (references, replaces, inText) => {
      if (inText) toText.current.push(...references);
      onAddImages(references, replaces);
    },
  );
  useEffect(() => {
    if (toText.current.length === 0) return;
    const waiting: string[] = [];
    for (const reference of toText.current) {
      const index = images.indexOf(reference);
      if (index === -1 || (!rawTextarea && !editor)) waiting.push(reference);
      else pointAtCaret(index);
    }
    toText.current = waiting;
  }, [images, editor, rawTextarea, pointAtCaret]);

  // Draws over image `index` with the pad. The drawing takes its place.
  const drawOver = (index: number) => {
    const image = images[index];
    if (image === undefined) return;
    requestDrawing((file) => attachFiles([file], image), image);
  };

  // Takes the pointers to image `index` out of the text. With `renumber`, the
  // image leaves the note, and later pointers move down
  // (`utils/inlineImages.ts`). Through the editor, never through `content`:
  // the editor reads that only when it opens, and would write the old
  // pointers back on its next change.
  const unpoint = (index: number, renumber: boolean) => {
    if (rawTextarea) {
      const value = rawTextarea.value;
      const next = withoutImagePointer(value, index, renumber);
      if (next !== value) {
        const caret = Math.min(rawTextarea.selectionStart, next.length);
        applyTextEdit(rawTextarea, {
          value: next,
          selectionStart: caret,
          selectionEnd: caret,
        });
      }
    } else if (editor) {
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = removeImagePointers(view.state, index, renumber);
        if (tr) view.dispatch(tr);
      });
    } else {
      const next = withoutImagePointer(content, index, renumber);
      if (next !== content) onContentChange(next);
    }
  };
  const removeImage = (index: number) => {
    unpoint(index, true);
    onRemoveImage(index);
  };

  // "Put in the text" of a header image: the next click in the text puts the
  // image there. The notice also offers the caret, for the keyboard.
  const textEditable = !disabled && !contentLocked;
  const [placing, setPlacing] = useState<number | null>(null);
  useEscapeStack(placing !== null, () => setPlacing(null));
  useEffect(() => {
    if (placing === null) return;
    if (rawTextarea) {
      // The click puts the caret first. Then the image goes there.
      const onClick = () => {
        pointAtCaret(placing);
        setPlacing(null);
      };
      rawTextarea.addEventListener("click", onClick);
      return () => rawTextarea.removeEventListener("click", onClick);
    }
    if (!editor) return;
    const dom = editor.action((ctx) => ctx.get(editorViewCtx).dom);
    // Captured, before ProseMirror moves the selection, or a press on the
    // buttons of an image in the text does its own action.
    const onDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const at = view.posAtCoords({ left: e.clientX, top: e.clientY });
        const tr = at && placeImagePointer(view.state, at.pos, placing);
        if (tr) view.dispatch(tr);
        view.focus();
      });
      setPlacing(null);
    };
    dom.addEventListener("mousedown", onDown, true);
    return () => dom.removeEventListener("mousedown", onDown, true);
  }, [placing, editor, rawTextarea, pointAtCaret]);

  // The buttons over an image in the text are those of the header, and two
  // more. The editor builds one time, and the buttons draw when an image does.
  // Thus, they run the actions of the latest render through a ref.
  const [fullInText, setFullInText] = useState<{
    index: number;
    describe: boolean;
  } | null>(null);
  const imageActions = {
    describe:
      disabled || !onDescribeImage
        ? undefined
        : (index: number) => setFullInText({ index, describe: true }),
    draw: disabled ? undefined : drawOver,
    remove: removeImage,
    moveOut: textEditable
      ? (index: number) => unpoint(index, false)
      : undefined,
    full: (index: number) => setFullInText({ index, describe: false }),
  };
  const imageActionsRef = useRef(imageActions);
  imageActionsRef.current = imageActions;
  // The views of the images in the text, to load again when the list changes.
  const imageReloads = useRef(new Map<HTMLElement, () => void>());
  useEffect(() => {
    for (const reload of imageReloads.current.values()) reload();
  }, [images]);
  const inlineImageControls = useMemo<InlineImageControls>(
    () => ({
      show: (container, index, reload) => {
        imageReloads.current.set(container, reload);
        const actions = () => imageActionsRef.current;
        const { describe, draw, moveOut } = actions();
        render(
          <ImageButtons
            onDescribe={describe && (() => actions().describe?.(index))}
            onEdit={draw && (() => actions().draw?.(index))}
            onDelete={() => actions().remove(index)}
            onMoveOutOfText={moveOut && (() => actions().moveOut?.(index))}
            onShowFull={() => actions().full(index)}
          />,
          container,
        );
      },
      hide: (container) => {
        imageReloads.current.delete(container);
        render(null, container);
      },
    }),
    [],
  );

  // A paste is in the text when it is inside the editor or the raw textarea,
  // and the text can change.
  const textRef = useRef<HTMLDivElement>(null);
  const isInText = useCallback(
    (target: EventTarget | null) =>
      !contentLocked &&
      target instanceof Node &&
      Boolean(textRef.current?.contains(target)),
    [contentLocked],
  );

  // A pad opened from this editor goes with it. If not, it would give its
  // drawing to uploads that are gone. A layout effect, as the own cleanup of
  // the uploads is. The cleanup of an effect waits until after the paint.
  useLayoutEffect(() => closeDrawing, []);

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
      onDraw={() => requestDrawing((file) => attachFiles([file]))}
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
      class={`${colors.bg} ${colors.border} note-surface note-color-transition relative z-10 sm:border sm:shadow-lg note-sheet-surface max-sm:flex max-sm:flex-col`}
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
          <div
            role="status"
            class="flex flex-wrap items-center gap-2 mb-2 text-sm"
          >
            <span>{t("editor.placeImageHint")}</span>
            <button
              type="button"
              class={buttonClass("secondary", "xs")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                pointAtCaret(placing);
                setPlacing(null);
              }}
            >
              {t("editor.placeImageAtCaret")}
            </button>
            <button
              type="button"
              class={buttonClass("quiet", "xs")}
              onClick={() => setPlacing(null)}
            >
              {t("editor.placeImageCancel")}
            </button>
          </div>
        )}

        {/* Shown or hidden for every note at once, from Settings. */}
        {!disabled && !contentLocked && formattingToolbar.value && editor && (
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

/**
 * Back (only on a phone) and the pin. On a wide screen, the pin floats at the
 * top right. On a phone, this is a row above the title, with undo and redo next
 * to the pin, and the toolbar of the note under it (`children`).
 */
function EditorTopBar({
  pinned,
  onPinToggle,
  onBack,
  disabled,
  history,
  children,
}: {
  pinned: boolean;
  onPinToggle: () => void;
  onBack: () => void;
  disabled: boolean | undefined;
  history: ComponentChildren;
  children: ComponentChildren;
}) {
  const pinLabel = pinned ? t("noteCard.unpin") : t("noteCard.pin");
  return (
    <div class="note-sheet-top">
      <div class="max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-2.5">
        <div class="sm:hidden">
          <button
            type="button"
            class={editorButtonClass}
            onClick={onBack}
            aria-label={t("editor.back")}
          >
            <ArrowLeft class="w-5 h-5 max-sm:w-6 max-sm:h-6" />
          </button>
        </div>
        <div class="sm:absolute sm:top-2 sm:right-2 flex items-center gap-0.5">
          {history}
          <Tooltip label={pinLabel}>
            <button
              type="button"
              class={`${editorButtonClass} transition-opacity`}
              onClick={onPinToggle}
              aria-label={pinLabel}
              disabled={disabled}
            >
              {pinned ? (
                <PinOff class={editorIconClass} />
              ) : (
                <Pin class={editorIconClass} />
              )}
            </button>
          </Tooltip>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The tags of the note, each with its remove button, and its reminder. */
function EditorChips({
  tags,
  onRemoveTag,
  reminder,
  onReminderChange,
}: {
  tags: string[];
  onRemoveTag: (tag: string) => void;
  reminder: NoteReminder | null | undefined;
  onReminderChange: ((reminder: NoteReminder | null) => void) | undefined;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const picker = usePresence(pickerOpen || null, CARD_POPOVER_EXIT_MS);
  const chipRef = useRef<HTMLButtonElement>(null);
  if (tags.length === 0 && !reminder) return null;
  return (
    <div class="flex flex-wrap gap-1 mt-2 items-center">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag}>
          <button
            type="button"
            class="hover:text-red-500 cursor-pointer"
            onClick={() => onRemoveTag(tag)}
            aria-label={t("editor.removeTag", { tag })}
          >
            ×
          </button>
        </TagChip>
      ))}
      {reminder && (
        <span class="relative">
          <ReminderChip
            reminder={reminder}
            anchorRef={chipRef}
            onClick={() => setPickerOpen(!pickerOpen)}
            expanded={pickerOpen}
            onClear={
              onReminderChange ? () => onReminderChange(null) : undefined
            }
            onDone={
              onReminderChange
                ? () => onReminderChange(reminderDone(reminder))
                : undefined
            }
          />
          {picker.shown && onReminderChange && (
            <CardPopover
              anchorRef={chipRef}
              onClose={() => setPickerOpen(false)}
              leaving={picker.leaving}
            >
              <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 w-72">
                <ReminderPickerPanel
                  reminder={reminder}
                  onChange={onReminderChange}
                  onDone={() => setPickerOpen(false)}
                />
              </div>
            </CardPopover>
          )}
        </span>
      )}
    </div>
  );
}
