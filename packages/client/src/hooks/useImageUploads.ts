import { MAX_IMAGE_SOURCE_BYTES } from "@manifesto/shared";
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";
import { formatFileSize, t } from "#/i18n/index.ts";
import { attachImage, ImageTooLargeError } from "#/state/attachments.ts";
import { showError } from "#/state/ui.ts";

export interface PendingUpload {
  key: string;
  file: File;
  /** A `blob:` URL of the file, drawn while it is on its way. */
  preview: string;
  /** 0 to 1. */
  progress: number;
  failed: boolean;
  controller: AbortController;
  /** The image of the note that this one replaces, after it is stored. */
  replaces?: string | undefined;
}

/**
 * Attached files become pending uploads. The code draws them immediately from
 * the local file, stores them (uploads them, in connected mode, with progress),
 * and gives them to `onAddImages` as the reference after they are stored, with
 * the image that it replaces if it was drawn over one. A failed upload stays,
 * with a mark and a retry. The code does not make a note that points to
 * nothing. An unmount (a close of the editor) cancels the uploads that are not
 * complete.
 */
export function useImageUploads(
  onAddImages: (references: string[], replaces?: string) => void,
) {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const uploadsRef = useRef<PendingUpload[]>([]);
  uploadsRef.current = uploads;
  const onAddImagesRef = useRef(onAddImages);
  onAddImagesRef.current = onAddImages;

  // A layout effect. Its cleanup runs when the editor unmounts. The cleanup of
  // an effect waits until after the paint, and an upload that completed between
  // them would go into the next draft.
  useLayoutEffect(
    () => () => {
      for (const upload of uploadsRef.current) {
        upload.controller.abort();
        URL.revokeObjectURL(upload.preview);
      }
    },
    [],
  );

  // Stable. Thus, an effect that attaches files (a paste listener) can name
  // them.
  const patchUpload = useCallback(
    (key: string, patch: Partial<PendingUpload>) =>
      setUploads((list) =>
        list.map((u) => (u.key === key ? { ...u, ...patch } : u)),
      ),
    [],
  );

  const dropUpload = useCallback(
    (key: string) =>
      setUploads((list) => {
        const upload = list.find((u) => u.key === key);
        if (upload) {
          upload.controller.abort();
          URL.revokeObjectURL(upload.preview);
        }
        return list.filter((u) => u.key !== key);
      }),
    [],
  );

  const runUpload = useCallback(
    (upload: PendingUpload) => {
      attachImage(upload.file, {
        signal: upload.controller.signal,
        onProgress: (progress) => patchUpload(upload.key, { progress }),
      })
        .then((stored) => {
          // Closed or removed while it completed: the image belongs to nothing.
          if (upload.controller.signal.aborted) return;
          dropUpload(upload.key);
          onAddImagesRef.current([stored], upload.replaces);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          if (err instanceof ImageTooLargeError) {
            showError(
              t("editor.imageTooLarge", {
                name: upload.file.name,
                size: formatFileSize(MAX_IMAGE_SOURCE_BYTES),
              }),
            );
            dropUpload(upload.key);
            return;
          }
          patchUpload(upload.key, { failed: true });
        });
    },
    [patchUpload, dropUpload],
  );

  const attachFiles = useCallback(
    (files: File[], replaces?: string) => {
      const added = files.map(
        (file): PendingUpload => ({
          key: `${Date.now()}-${Math.random()}`,
          file,
          preview: URL.createObjectURL(file),
          progress: 0,
          failed: false,
          controller: new AbortController(),
          replaces,
        }),
      );
      setUploads((list) => [...list, ...added]);
      for (const upload of added) runUpload(upload);
    },
    [runUpload],
  );

  const retryUpload = useCallback(
    (key: string) => {
      const upload = uploadsRef.current.find((u) => u.key === key);
      if (!upload) return;
      const fresh = {
        ...upload,
        progress: 0,
        failed: false,
        controller: new AbortController(),
      };
      setUploads((list) => list.map((u) => (u.key === key ? fresh : u)));
      runUpload(fresh);
    },
    [runUpload],
  );

  return { uploads, attachFiles, retryUpload, dropUpload };
}
