import type {
  LinkPreview,
  NoteColor,
  NoteFont,
  NoteReminder,
} from "@manifesto/shared";
import { type Editor, editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import { redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { redoDepth, undoDepth } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { callCommand } from "@milkdown/kit/utils";
import { ArrowLeft, Pin, PinOff } from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import {
  deleteCheckedItemsIn,
  docHasCheckedItems,
} from "../extensions/taskListStructure.js";
import { useImageUploads } from "../hooks/useImageUploads.js";
import { usePresence } from "../hooks/usePresence.js";
import { t } from "../i18n/index.js";
import { defaultEditMode, formattingToolbar } from "../state/prefs.js";
import { extractUrls } from "../utils/linkPreview.js";
import {
  removeCheckedItems,
  hasCheckedItems as textHasCheckedItems,
} from "../utils/markdown.js";
import { applyTextEdit } from "../utils/rawFormatting.js";
import { editorBtnClass, editorIconClass } from "./editorButtons.js";
import { FormattingToolbar } from "./FormattingToolbar.js";
import { ImageGallery } from "./ImageGallery.js";
import { LinkPreviewList } from "./LinkPreviewList.js";
import { MilkdownEditor } from "./MilkdownEditor.js";
import { NoteEditorToolbar } from "./NoteEditorToolbar.js";
import type { NoteMenuItem } from "./NoteMenu.js";
import { PendingUploads } from "./PendingUploads.js";
import { CARD_POPOVER_EXIT_MS, CardPopover } from "./Popover.js";
import { ReminderChip } from "./ReminderChip.js";
import { ReminderPickerPanel } from "./ReminderPicker.js";
import { Tooltip } from "./Tooltip.js";

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
  onAddImages: (dataUrls: string[]) => void;
  onRemoveImage: (index: number) => void;
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
   * are checked items to delete, and how to delete them, are only knowable
   * here, since in collab mode the shared document is the only copy that counts.
   */
  menuItems?: (editorActions: {
    checkedItems: { present: boolean; remove: () => void };
  }) => NoteMenuItem[];
  /** Discards an unsaved draft. Shown as a toolbar button, not a menu row. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** Puts the caret in the text once the editor is built. On by default. */
  autoFocus?: boolean;
  /** The editor instance, each time one is built (it is rebuilt when
   * collaboration arrives). */
  onEditorReady?: (editor: Editor) => void;
  collab?: {
    ydoc: import("yjs").Doc;
    fragmentName?: string;
    awareness?: import("y-protocols/awareness").Awareness;
  };
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
  onAddImages,
  onRemoveImage,
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
  const [showReminderChipPicker, setShowReminderChipPicker] = useState(false);
  const reminderChipPicker = usePresence(
    showReminderChipPicker || null,
    CARD_POPOVER_EXIT_MS,
  );
  // Read once, when the editor opens: changing the default mid-edit should
  // not flip a note that is already open.
  const [rawMode, setRawMode] = useState(
    () => defaultEditMode.peek() === "raw",
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  // Counter bumped on every editor transaction; drives undo/redo button
  // state and toolbar active-format refresh.
  const [txCount, setTxCount] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);
  const reminderChipRef = useRef<HTMLButtonElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  // The textarea is always mounted, only hidden, so this is the one switch for
  // everything that edits "the note's text": in raw mode that is the textarea,
  // and the rich editor behind it is rebuilt from it on the way back.
  const rawTextarea = rawMode ? rawTextareaRef.current : null;

  const { uploads, attachFiles, retryUpload, dropUpload } =
    useImageUploads(onAddImages);

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = [...files].filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length > 0) attachFiles(imageFiles);
  };

  useEffect(() => {
    if (disabled) return;
    const handlePaste = async (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const imageItems = [...e.clipboardData.items].filter((it) =>
        it.type.startsWith("image/"),
      );
      if (imageItems.length > 0) {
        const files = imageItems
          .map((it) => it.getAsFile())
          .filter((f): f is File => f !== null);
        if (files.length > 0) {
          e.preventDefault();
          attachFiles(files);
          return;
        }
      }
      // Only text pasted into the note's body becomes a card. The listener is
      // on the document, so it also hears a URL pasted into the title, the
      // toolbar's link box or a tag field, none of which is asking for one.
      if (e.target instanceof HTMLInputElement) return;
      const text = e.clipboardData.getData("text");
      if (text) {
        const urls = extractUrls(text);
        if (urls.length > 0) onAddLinkPreviews(urls);
      }
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [disabled, onAddLinkPreviews]);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const prev =
        view.props.dispatchTransaction?.bind(view) ??
        ((tr: Parameters<typeof view.state.apply>[0]) =>
          view.updateState(view.state.apply(tr)));
      view.setProps({
        dispatchTransaction(tr) {
          prev(tr);
          if (!cancelled) setTxCount((c) => c + 1);
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [editor]);

  // The rich editor's transactions are what refresh the toolbar in rich mode;
  // in raw mode the textarea's typing and caret moves have to do it instead.
  useEffect(() => {
    const textarea = rawTextareaRef.current;
    if (!rawMode || !textarea) return;
    const bump = () => setTxCount((c) => c + 1);
    const onSelectionChange = () => {
      if (document.activeElement === textarea) bump();
    };
    const events = ["input", "select", "keyup", "mouseup", "focus"] as const;
    for (const type of events) textarea.addEventListener(type, bump);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      for (const type of events) textarea.removeEventListener(type, bump);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [rawMode]);

  const focusText = (at: "start" | "end") => {
    if (rawTextarea) {
      const pos = at === "start" ? 0 : rawTextarea.value.length;
      rawTextarea.focus();
      rawTextarea.setSelectionRange(pos, pos);
      return;
    }
    editor?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.focus();
      const { doc } = view.state;
      view.dispatch(
        view.state.tr.setSelection(
          at === "start"
            ? TextSelection.atStart(doc)
            : TextSelection.atEnd(doc),
        ),
      );
    });
  };

  const colors = noteColorMap[color];

  // Read straight off the editor on every render rather than memoised: the
  // `txCount` bump in `dispatchTransaction` is what schedules that render, so
  // these are as fresh as the last transaction.
  //
  // The undo buttons drive the rich editor's history, which in raw mode
  // belongs to a document that is about to be replaced, so they stand down
  // there; the textarea's own undo (Cmd+Z) covers raw edits, toolbar ones
  // included.
  const canUndo =
    editor && !rawMode
      ? editor.action((ctx) => undoDepth(ctx.get(editorStateCtx)) > 0)
      : false;
  const canRedo =
    editor && !rawMode
      ? editor.action((ctx) => redoDepth(ctx.get(editorStateCtx)) > 0)
      : false;
  const hasCheckedItems = rawTextarea
    ? textHasCheckedItems(rawTextarea.value)
    : editor
      ? editor.action((ctx) => docHasCheckedItems(ctx.get(editorStateCtx).doc))
      : false;

  const deleteCheckedItems = () => {
    if (rawTextarea) {
      const value = removeCheckedItems(rawTextarea.value);
      const caret = Math.min(rawTextarea.selectionStart, value.length);
      applyTextEdit(rawTextarea, {
        value,
        selectionStart: caret,
        selectionEnd: caret,
      });
      return;
    }
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      deleteCheckedItemsIn(view);
      view.focus();
    });
  };

  const checkedItems = { present: hasCheckedItems, remove: deleteCheckedItems };

  return (
    <article
      class={`${colors.bg} ${colors.border} note-surface note-color-transition relative z-10 sm:border sm:shadow-lg note-sheet-surface max-sm:flex max-sm:flex-col`}
    >
      {/* Top bar: back (mobile only) + pin. On desktop, pin floats absolute
          top-right; on mobile, this is a flex row above the title. */}
      <div class="note-sheet-top max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-2.5">
        <div class="sm:hidden">
          <button
            type="button"
            class={editorBtnClass}
            onClick={onBack ?? onDone}
            aria-label={t("editor.back")}
          >
            <ArrowLeft class="w-5 h-5 max-sm:w-6 max-sm:h-6" />
          </button>
        </div>
        <div class="sm:absolute sm:top-2 sm:right-2 flex items-center gap-0.5">
          <Tooltip label={pinned ? t("noteCard.unpin") : t("noteCard.pin")}>
            <button
              type="button"
              class={`${editorBtnClass} transition-opacity`}
              onClick={onPinToggle}
              aria-label={pinned ? t("noteCard.unpin") : t("noteCard.pin")}
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

      {images.length > 0 && (
        <ImageGallery images={images} onDelete={onRemoveImage} />
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
          value={title}
          onInput={(e) => onTitleChange((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              focusText("start");
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
            tick={txCount}
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
            focusText("end");
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

        {(tags.length > 0 || reminder) && (
          <div class="flex flex-wrap gap-1 mt-2 items-center">
            {tags.map((tag) => (
              <span
                key={tag}
                class="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-neutral-200/60 dark:bg-neutral-700/60"
              >
                #{tag}
                <button
                  type="button"
                  class="hover:text-red-500 cursor-pointer"
                  onClick={() => onRemoveTag(tag)}
                  aria-label={t("editor.removeTag", { tag })}
                >
                  ×
                </button>
              </span>
            ))}
            {reminder && (
              <span class="relative">
                <ReminderChip
                  reminder={reminder}
                  anchorRef={reminderChipRef}
                  onClick={() =>
                    setShowReminderChipPicker(!showReminderChipPicker)
                  }
                  onClear={
                    onReminderChange ? () => onReminderChange(null) : undefined
                  }
                />
                {reminderChipPicker.shown && onReminderChange && (
                  <CardPopover
                    anchorRef={reminderChipRef}
                    onClose={() => setShowReminderChipPicker(false)}
                    leaving={reminderChipPicker.leaving}
                  >
                    <div class="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 w-72">
                      <ReminderPickerPanel
                        reminder={reminder}
                        onChange={onReminderChange}
                        onDone={() => setShowReminderChipPicker(false)}
                      />
                    </div>
                  </CardPopover>
                )}
              </span>
            )}
          </div>
        )}
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
        rawMode={rawMode}
        onToggleRawMode={() => setRawMode(!rawMode)}
        menuItems={menuItems?.({ checkedItems }) ?? []}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => editor?.action(callCommand(undoCommand.key))}
        onRedo={() => editor?.action(callCommand(redoCommand.key))}
        onDelete={onDelete}
        deleteLabel={deleteLabel}
        onDone={onDone}
        disabled={disabled}
      />
    </article>
  );
}
