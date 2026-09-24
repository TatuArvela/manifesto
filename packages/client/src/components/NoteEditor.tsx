import type { LinkPreview, NoteReminder } from "@manifesto/shared";
import {
  MAX_IMAGE_DATA_URL_BYTES,
  MAX_IMAGE_SOURCE_BYTES,
  type NoteColor,
  NoteFont,
} from "@manifesto/shared";
import { type Editor, editorStateCtx, editorViewCtx } from "@milkdown/kit/core";
import { redoCommand, undoCommand } from "@milkdown/kit/plugin/history";
import { redoDepth, undoDepth } from "@milkdown/kit/prose/history";
import { TextSelection } from "@milkdown/kit/prose/state";
import { callCommand } from "@milkdown/kit/utils";
import {
  ArrowLeft,
  Check,
  Code,
  EllipsisVertical,
  Eye,
  Image as ImageIcon,
  Palette,
  Pin,
  PinOff,
  Redo,
  Type,
  Undo,
  X,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import { getDeletionRange } from "../extensions/taskItemDraggable.js";
import { usePresence } from "../hooks/usePresence.js";
import {
  formatFileSize,
  getColorPickerColors,
  getFontLabel,
  t,
} from "../i18n/index.js";
import { hasCheckedItems as textHasCheckedItems } from "../state/actions.js";
import { defaultEditMode, formattingToolbar } from "../state/prefs.js";
import { showError } from "../state/ui.js";
import { extractUrls } from "../utils/linkPreview.js";
import { removeCheckedItems } from "../utils/markdown.js";
import { applyTextEdit } from "../utils/rawFormatting.js";
import { shrinkImage } from "../utils/shrinkImage.js";
import { Dropdown } from "./Dropdown.js";
import { FormattingToolbar } from "./FormattingToolbar.js";
import { ImageGallery } from "./ImageGallery.js";
import { LinkPreviewList } from "./LinkPreviewList.js";
import { MilkdownEditor } from "./MilkdownEditor.js";
import {
  menuDividerClass,
  menuItemClass,
  menuPanelClass,
  NoteMenu,
  type NoteMenuItem,
} from "./NoteMenu.js";
import { CARD_POPOVER_EXIT_MS, CardPopover } from "./Popover.js";
import { ReminderChip } from "./ReminderChip.js";
import { ReminderPicker, ReminderPickerPanel } from "./ReminderPicker.js";
import { TagPickerButton } from "./TagPicker.js";
import { Tooltip } from "./Tooltip.js";

const iconBtnClass =
  "p-1.5 max-sm:p-2.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer";

/**
 * The open note's buttons and icons. A fifth larger than a card's on a phone,
 * where the editor fills the screen and is worked with a thumb: 36px targets
 * become 43px.
 */
const editorBtnClass =
  "p-1.5 max-sm:p-3 rounded-full hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer";
const editorIconClass = "w-4 h-4 max-sm:w-[1.2rem] max-sm:h-[1.2rem]";

export { editorBtnClass, editorIconClass, iconBtnClass };

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
  metadata,
  menuItems,
  onDelete,
  deleteLabel,
  collab,
}: NoteEditorProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reminderChipRef = useRef<HTMLButtonElement>(null);
  const rawTextareaRef = useRef<HTMLTextAreaElement>(null);
  // The textarea is always mounted, only hidden, so this is the one switch for
  // everything that edits "the note's text": in raw mode that is the textarea,
  // and the rich editor behind it is rebuilt from it on the way back.
  const rawTextarea = rawMode ? rawTextareaRef.current : null;

  // Measured on the encoded data URL rather than `file.size`, because that is
  // the value the server bounds and base64 inflates by about a third, so a check
  // against the raw file would let something through that then 422s. Server
  // mode is the only place the cap is enforced remotely, but rejecting here
  // too keeps a note's behaviour the same in both modes and turns a bare 422
  // into a message naming the file.
  const readFilesAsDataUrls = async (files: File[]): Promise<string[]> => {
    const results = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        blob: await shrinkImage(file),
      })),
    ).then((shrunk) =>
      Promise.all(
        shrunk.map(
          ({ name, blob }) =>
            new Promise<{ name: string; url: string | null }>((resolve) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  name,
                  url: typeof reader.result === "string" ? reader.result : null,
                });
              reader.onerror = () => resolve({ name, url: null });
              reader.readAsDataURL(blob);
            }),
        ),
      ),
    );
    const accepted: string[] = [];
    for (const { name, url } of results) {
      if (url === null) continue;
      if (url.length > MAX_IMAGE_DATA_URL_BYTES) {
        showError(
          t("editor.imageTooLarge", {
            name,
            size: formatFileSize(MAX_IMAGE_SOURCE_BYTES),
          }),
        );
        continue;
      }
      accepted.push(url);
    }
    return accepted;
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const imageFiles = [...files].filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const urls = await readFilesAsDataUrls(imageFiles);
    if (urls.length > 0) onAddImages(urls);
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
          const urls = await readFilesAsDataUrls(files);
          if (urls.length > 0) onAddImages(urls);
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
  }, [disabled, onAddImages, onAddLinkPreviews]);

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
  const pickerColors = getColorPickerColors();

  const closeAllMenus = () => {
    setShowColorPicker(false);
    setShowFontPicker(false);
    setShowMenu(false);
  };

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
      ? editor.action((ctx) => {
          const state = ctx.get(editorStateCtx);
          let found = false;
          state.doc.descendants((node) => {
            if (found) return false;
            if (node.type.name === "list_item" && node.attrs.checked === true) {
              found = true;
              return false;
            }
          });
          return found;
        })
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
      // Delete one checked item at a time so getDeletionRange re-evaluates
      // ancestor lists after each removal (emptied single-child lists get
      // pruned on the next pass).
      while (true) {
        const { doc } = view.state;
        let targetPos = -1;
        let targetSize = 0;
        doc.descendants((node, pos) => {
          if (targetPos >= 0) return false;
          if (node.type.name === "list_item" && node.attrs.checked === true) {
            targetPos = pos;
            targetSize = node.nodeSize;
            return false;
          }
        });
        if (targetPos < 0) break;
        const range = getDeletionRange(doc, targetPos, targetSize);
        view.dispatch(view.state.tr.delete(range.from, range.to));
      }
      view.focus();
    });
  };

  const checkedItems = { present: hasCheckedItems, remove: deleteCheckedItems };

  // Rendered in one of two places, see the toolbar below.
  const imageButton = (
    <Tooltip label={t("editor.addImage")}>
      <button
        type="button"
        class={editorBtnClass}
        onClick={() => fileInputRef.current?.click()}
        aria-label={t("editor.addImage")}
        disabled={disabled}
      >
        <ImageIcon class={editorIconClass} />
      </button>
    </Tooltip>
  );

  return (
    <article
      class={`${colors.bg} ${colors.border} note-surface note-color-transition relative z-10 sm:border sm:shadow-lg max-sm:h-full max-sm:flex max-sm:flex-col max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]`}
    >
      {/* Top bar: back (mobile only) + pin. On desktop, pin floats absolute
          top-right; on mobile, this is a flex row above the title. */}
      <div class="max-sm:flex max-sm:items-center max-sm:justify-between max-sm:px-2.5 max-sm:pt-2">
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

      <div class="p-4 max-sm:px-4 max-sm:pt-2 max-sm:flex-1 max-sm:overflow-y-auto max-sm:min-h-0 max-sm:flex max-sm:flex-col">
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

        {/* biome-ignore lint/a11y/noStaticElementInteractions: padding-area focus forward; inner contentEditable is the real target */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users tab into the inner contentEditable directly */}
        <div
          class="max-sm:flex-1 max-sm:min-h-0 max-sm:cursor-text"
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
            autoFocus
            onEditorReady={setEditor}
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

      {/* The bottom toolbar. Two groups that wrap as units: the first tools,
          and everything else. When a phone is too narrow for one row, the
          first group is what gives way, so it moves up a row and the controls
          a thumb reaches for (the menu, undo, done) keep the bottom one. */}
      <div class="px-3 pt-1.5 pb-2 flex flex-wrap items-center gap-0.5">
        <div class="flex items-center gap-0.5">
          <Dropdown
            open={showColorPicker}
            onClose={() => setShowColorPicker(false)}
            trigger={
              <Tooltip label={t("editor.color")}>
                <button
                  type="button"
                  class={editorBtnClass}
                  onClick={() => {
                    setShowColorPicker(!showColorPicker);
                    setShowMenu(false);
                    setShowFontPicker(false);
                  }}
                  aria-label={t("editor.changeColor")}
                >
                  <Palette class={editorIconClass} />
                </button>
              </Tooltip>
            }
            placement="top-start"
            panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
          >
            {pickerColors.map((c) => (
              <Tooltip key={c.value} label={c.label}>
                <button
                  type="button"
                  class={`w-6 h-6 rounded-full cursor-pointer ${c.swatch} ${color === c.value ? "ring-2 ring-blue-500 ring-offset-1" : ""}`}
                  onClick={() => onColorChange(c.value)}
                  aria-label={c.label}
                />
              </Tooltip>
            ))}
          </Dropdown>

          {/* Font picker (desktop only; on mobile, fonts live in the kebab menu) */}
          <div class="max-sm:hidden flex">
            <Dropdown
              open={showFontPicker}
              onClose={() => setShowFontPicker(false)}
              trigger={
                <Tooltip label={t("editor.font")}>
                  <button
                    type="button"
                    class={editorBtnClass}
                    onClick={() => {
                      setShowFontPicker(!showFontPicker);
                      setShowColorPicker(false);
                      setShowMenu(false);
                    }}
                    aria-label={t("editor.changeFont")}
                  >
                    <Type class={editorIconClass} />
                  </button>
                </Tooltip>
              }
              placement="top-start"
              panelClass="p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-lg border border-neutral-200 dark:border-neutral-700 flex gap-1"
            >
              {Object.values(NoteFont).map((f) => {
                const label = getFontLabel(f);
                return (
                  <Tooltip key={f} label={label}>
                    <button
                      type="button"
                      class={`px-2 py-1 text-sm rounded cursor-pointer ${font === f ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                      style={{
                        fontFamily: noteFontFamilies[f] || undefined,
                      }}
                      onClick={() => onFontChange(f)}
                      aria-label={label}
                    >
                      Aa
                    </button>
                  </Tooltip>
                );
              })}
            </Dropdown>
          </div>

          {/* The second tool on a phone. A new note has no reminder, so there
              the image button takes its place. */}
          {onReminderChange ? (
            <ReminderPicker
              reminder={reminder ?? null}
              onChange={onReminderChange}
              triggerClass={editorBtnClass}
              iconClass={editorIconClass}
            />
          ) : (
            imageButton
          )}
        </div>

        {/* `grow` so that on a row of its own it still spans the bar. It does
            not wrap inside itself, so it only ever moves as a whole. */}
        <div class="grow flex items-center gap-0.5">
          {onReminderChange && imageButton}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            class="hidden"
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              handleFilesSelected(input.files);
              input.value = "";
            }}
          />

          <TagPickerButton
            tags={tags}
            onAddTag={onAddTag}
            triggerClass={editorBtnClass}
            iconClass={editorIconClass}
          />

          <Dropdown
            open={showMenu}
            onClose={() => setShowMenu(false)}
            trigger={
              <Tooltip label={t("noteMenu.more")}>
                <button
                  type="button"
                  class={editorBtnClass}
                  onClick={() => {
                    setShowMenu(!showMenu);
                    setShowColorPicker(false);
                    setShowFontPicker(false);
                  }}
                  aria-label={t("noteMenu.moreOptions")}
                >
                  <EllipsisVertical class={editorIconClass} />
                </button>
              </Tooltip>
            }
            placement="top-start"
            panelClass={menuPanelClass}
          >
            <div class="sm:hidden px-3 pt-1.5 pb-1 text-xs text-neutral-500 dark:text-neutral-400">
              {t("editor.font")}
            </div>
            <div class="sm:hidden flex gap-1 px-3 pb-2">
              {Object.values(NoteFont).map((f) => {
                const label = getFontLabel(f);
                return (
                  <button
                    key={f}
                    type="button"
                    class={`px-2 py-1 text-sm rounded cursor-pointer ${font === f ? "ring-2 ring-blue-500 ring-offset-1" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
                    style={{ fontFamily: noteFontFamilies[f] || undefined }}
                    onClick={() => onFontChange(f)}
                    aria-label={label}
                  >
                    Aa
                  </button>
                );
              })}
            </div>

            {/* Raw / Normal mode toggle (mobile only) */}
            <button
              type="button"
              class={`sm:hidden ${menuItemClass}`}
              onClick={() => {
                setRawMode(!rawMode);
                closeAllMenus();
              }}
            >
              {rawMode ? <Eye class="w-4 h-4" /> : <Code class="w-4 h-4" />}
              {rawMode ? t("editor.normalMode") : t("editor.rawMode")}
            </button>

            <div class={`sm:hidden ${menuDividerClass}`} />

            <NoteMenu
              items={menuItems?.({ checkedItems }) ?? []}
              onClose={() => setShowMenu(false)}
            />
          </Dropdown>

          {/* Normal / Raw mode toggle (desktop only; on mobile, lives in the kebab menu) */}
          <div class="max-sm:hidden flex">
            <Tooltip
              label={rawMode ? t("editor.normalMode") : t("editor.rawMode")}
            >
              <button
                type="button"
                class={editorBtnClass}
                onClick={() => setRawMode(!rawMode)}
                aria-label={
                  rawMode ? t("editor.normalMode") : t("editor.rawMode")
                }
              >
                {rawMode ? (
                  <Eye class={editorIconClass} />
                ) : (
                  <Code class={editorIconClass} />
                )}
              </button>
            </Tooltip>
          </div>

          {/* Centered between the tools and Done on a phone, inline on desktop. */}
          <div class="flex-1 sm:hidden" />

          <div class="flex items-center gap-0.5">
            <Tooltip label={t("editor.undo")}>
              <button
                type="button"
                class={`${editorBtnClass} ${canUndo ? "" : "opacity-30 cursor-default"}`}
                onClick={() => editor?.action(callCommand(undoCommand.key))}
                aria-label={t("editor.undo")}
                disabled={!canUndo}
              >
                <Undo class={editorIconClass} />
              </button>
            </Tooltip>
            <Tooltip label={t("editor.redo")}>
              <button
                type="button"
                class={`${editorBtnClass} ${canRedo ? "" : "opacity-30 cursor-default"}`}
                onClick={() => editor?.action(callCommand(redoCommand.key))}
                aria-label={t("editor.redo")}
                disabled={!canRedo}
              >
                <Redo class={editorIconClass} />
              </button>
            </Tooltip>
          </div>

          <div class="flex-1" />

          {onDelete && deleteLabel && (
            <Tooltip label={deleteLabel}>
              <button
                type="button"
                class={editorBtnClass}
                onClick={onDelete}
                aria-label={deleteLabel}
              >
                <X class={editorIconClass} />
              </button>
            </Tooltip>
          )}

          <Tooltip label={t("editor.done")}>
            <button
              type="button"
              class={editorBtnClass}
              onClick={onDone}
              aria-label={t("editor.done")}
            >
              <Check class={editorIconClass} />
            </button>
          </Tooltip>
        </div>
      </div>
    </article>
  );
}
