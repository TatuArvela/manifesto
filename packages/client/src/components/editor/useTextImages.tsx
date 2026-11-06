import { isStoredImageRef } from "@manifesto/shared";
import { type Editor, editorViewCtx } from "@milkdown/kit/core";
import { render } from "preact";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { ImageButtons } from "#/components/ImageGallery.tsx";
import {
  placeImagePointer,
  removeImagePointers,
} from "#/extensions/imagePointers.ts";
import type { InlineImageControls } from "#/extensions/inlineImageView.ts";
import { applyFormat } from "#/extensions/richFormatting.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useImageUploads } from "#/hooks/useImageUploads.ts";
import { attachmentObjectUrl } from "#/state/attachments.ts";
import { closeDrawing, requestDrawing } from "#/state/drawing.ts";
import { withoutImagePointer } from "#/utils/inlineImages.ts";
import { applyRawFormat, applyTextEdit } from "#/utils/rawFormatting.ts";

interface TextImagesOptions {
  images: string[];
  imageAlts: string[] | undefined;
  /** The rich editor, while it is built. */
  editor: Editor | null;
  /** The raw textarea, while it is the text on the screen. */
  rawTextarea: HTMLTextAreaElement | null;
  content: string;
  onContentChange: (value: string) => void;
  onAddImages: (dataUrls: string[], replaces?: string) => void;
  onRemoveImage: (index: number) => void;
  onDescribeImage: ((image: string, alt: string) => void) | undefined;
  disabled: boolean | undefined;
  contentLocked: boolean | undefined;
}

/**
 * The images of a note in `NoteEditor`, and the pointers to them in its text
 * (`utils/inlineImages.ts`): the uploads, the placement of a header image in
 * the text, and the buttons over an image in the text.
 */
export function useTextImages({
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
}: TextImagesOptions) {
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

  // A pad opened from this editor goes with it. If not, it would give its
  // drawing to uploads that are gone. A layout effect, as the own cleanup of
  // the uploads is. The cleanup of an effect waits until after the paint.
  useLayoutEffect(() => closeDrawing, []);

  return {
    resolveInlineImage,
    pointAtCaret,
    uploads,
    attachFiles,
    retryUpload,
    dropUpload,
    drawOver,
    removeImage,
    textEditable,
    placing,
    setPlacing,
    fullInText,
    setFullInText,
    inlineImageControls,
  };
}
