import type {
  LinkPreview,
  NoteColor,
  NoteFont,
  NoteReminder,
} from "@manifesto/shared";
import type { Editor } from "@milkdown/kit/core";
import { ArrowLeft, Pin, PinOff } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../../colors.js";
import { useEditorTicks } from "../../hooks/useEditorTicks.js";
import { useImageUploads } from "../../hooks/useImageUploads.js";
import { useNotePaste } from "../../hooks/useNotePaste.js";
import { usePresence } from "../../hooks/usePresence.js";
import { t } from "../../i18n/index.js";
import { closeDrawing, requestDrawing } from "../../state/drawing.js";
import { defaultEditMode, formattingToolbar } from "../../state/prefs.js";
import type { NoteMenuItem } from "../card/NoteMenu.js";
import { ImageGallery } from "../ImageGallery.js";
import { LinkPreviewList } from "../LinkPreviewList.js";
import { PendingUploads } from "../PendingUploads.js";
import { CARD_POPOVER_EXIT_MS, CardPopover } from "../Popover.js";
import { ReminderChip } from "../ReminderChip.js";
import { ReminderPickerPanel } from "../ReminderPicker.js";
import { TagChip } from "../TagChip.js";
import { Tooltip } from "../Tooltip.js";
import { editorButtonClass, editorIconClass } from "./editorButtons.js";
import { FormattingToolbar } from "./FormattingToolbar.js";
import { MilkdownEditor } from "./MilkdownEditor.js";
import { NoteEditorToolbar } from "./NoteEditorToolbar.js";
import { textActions } from "./textActions.js";

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
  /** What each image shows, in words, in step with `images`. */
  imageAlts?: string[] | undefined;
  /** With `replaces`, in place of that image rather than after the rest. */
  onAddImages: (dataUrls: string[], replaces?: string) => void;
  /** Pictures to attach as the editor opens, picked or drawn on the card. */
  initialFiles?: File[] | undefined;
  onRemoveImage: (index: number) => void;
  /** Left out where the images cannot be described. */
  onDescribeImage?: ((image: string, alt: string) => void) | undefined;
  linkPreviews: LinkPreview[];
  /** Every URL from one paste, together, so they land in a single write. */
  onAddLinkPreviews: (urls: string[]) => void;
  onRemoveLinkPreview: (index: number) => void;
  pinned: boolean;
  onPinToggle: () => void;
  tags: string[];
  /** Called with a normalized tag the note does not have yet. */
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
  reminder?: NoteReminder | null;
  onReminderChange?: (reminder: NoteReminder | null) => void;
  onDone: () => void;
  /** The phone's back arrow. Defaults to `onDone`. */
  onBack?: () => void;
  disabled?: boolean;
  contentLocked?: boolean;
  /** A line about the note's state, shown between the title and the text. */
  notice?: ComponentChildren;
  metadata?: ComponentChildren;
  /**
   * The rows of the kebab menu. Taken as a builder rather than a list because
   * two of them belong to the document rather than to the note: whether there
   * are checked items to delete or dated ones to sort, and how to do either,
   * are only knowable here, since in collab mode the shared document is the
   * only copy that counts.
   */
  menuItems?: (editorActions: {
    checkedItems: { present: boolean; remove: () => void };
    datedItems: { present: boolean; sort: () => void };
  }) => NoteMenuItem[];
  /** Discards an unsaved draft. Shown as a toolbar button, not a menu row. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Puts the caret in the text once the editor is built. On by default. */
  autoFocus?: boolean;
  /** The editor instance, each time one is built (it is rebuilt when
   * collaboration arrives). */
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
  // Read once, when the editor opens: changing the default mid-edit should
  // not flip a note that is already open.
  const [rawMode, setRawMode] = useState(
    () => defaultEditMode.peek() === "raw",
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  // The textarea is always mounted, only hidden, so this is the one switch for
  // everything that edits "the note's text": in raw mode that is the textarea,
  // and the rich editor behind it is rebuilt from it on the way back.
  const rawTextarea = rawMode ? rawTextareaRef.current : null;

  const { uploads, attachFiles, retryUpload, dropUpload } =
    useImageUploads(onAddImages);

  // A pad opened from this editor goes with it: its drawing would be handed
  // to uploads that are no longer there. A layout effect, as the uploads'
  // own cleanup is: an effect's is put off until after the paint.
  useLayoutEffect(() => closeDrawing, []);

  // Pictures picked or drawn on the card that opened this editor, attached
  // once as it opens.
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

  useNotePaste({ disabled, attachFiles, onAddLinkPreviews });
  // Drives the undo buttons and the toolbar's active formats.
  const tick = useEditorTicks(editor, rawMode, rawTextareaRef);
  const actions = textActions(editor, rawMode, rawTextarea);

  const colors = noteColorMap[color];

  return (
    <article
      class={`${colors.bg} ${colors.border} note-surface note-color-transition relative z-10 sm:border sm:shadow-lg note-sheet-surface max-sm:flex max-sm:flex-col`}
    >
      <EditorTopBar
        pinned={pinned}
        onPinToggle={onPinToggle}
        onBack={onBack ?? onDone}
        disabled={disabled}
      />

      {images.length > 0 && (
        <ImageGallery
          images={images}
          alts={imageAlts}
          onDescribe={disabled ? undefined : onDescribeImage}
          onDelete={onRemoveImage}
          onEdit={
            disabled
              ? undefined
              : (index) => {
                  const image = images[index];
                  if (image === undefined) return;
                  requestDrawing((file) => attachFiles([file], image), image);
                }
          }
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

        {/* Shown or hidden for every note at once, from Settings. */}
        {!disabled && !contentLocked && formattingToolbar.value && editor && (
          <FormattingToolbar
            editor={editor}
            rawTextarea={rawTextarea}
            tick={tick}
            disabled={disabled}
            onAddLink={(url) => onAddLinkPreviews([url])}
          />
        )}

        {/* Grows to fill a short note's screen, so a tap below the text
            still lands in it, but never shrinks below the text: the column
            around it is what scrolls, and a wrapper shorter than its text
            lets the text run over the timestamps and tags under it. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: padding-area focus forward; inner contentEditable is the real target */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users tab into the inner contentEditable directly */}
        <div
          class="max-sm:flex-1 max-sm:cursor-text"
          style={{ fontFamily: noteFontFamilies[font] || undefined }}
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            actions.focusText("end");
          }}
        >
          <MilkdownEditor
            // useMilkdownEditor builds once on mount, reading `collab` as it
            // stands then. The provider always resolves later than the first
            // render, so without remounting here the collab plugin is never
            // installed and the editor silently stays solo.
            key={collab ? "collab" : "solo"}
            content={content}
            onChange={onContentChange}
            disabled={disabled}
            contentLocked={contentLocked}
            rawMode={rawMode}
            textareaRef={rawTextareaRef}
            autoFocus={autoFocus}
            onEditorReady={(instance) => {
              setEditor(instance);
              onEditorReady?.(instance);
            }}
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

      <NoteEditorToolbar
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
    </article>
  );
}

/**
 * Back (on a phone only) and the pin. On a wide screen the pin floats at the
 * top right; on a phone this is a row above the title.
 */
function EditorTopBar({
  pinned,
  onPinToggle,
  onBack,
  disabled,
}: {
  pinned: boolean;
  onPinToggle: () => void;
  onBack: () => void;
  disabled: boolean | undefined;
}) {
  const pinLabel = pinned ? t("noteCard.unpin") : t("noteCard.pin");
  return (
    <div class="note-sheet-top max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-2.5">
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
  );
}

/** The note's tags, each with its remove button, and its reminder. */
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
