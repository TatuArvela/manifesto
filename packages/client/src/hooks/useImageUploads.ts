import { MAX_IMAGE_SOURCE_BYTES } from "@manifesto/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { formatFileSize, t } from "../i18n/index.js";
import { attachImage, ImageTooLargeError } from "../state/attachments.js";
import { showError } from "../state/ui.js";

export interface PendingUpload {
  key: string;
  file: File;
  /** A `blob:` URL of the file, drawn while it is on its way. */
  preview: string;
  /** 0 to 1. */
  progress: number;
  failed: boolean;
  controller: AbortController;
}

/**
 * Attached files become pending uploads: drawn at once from the local file,
 * stored (uploaded, in connected mode, with progress), and handed to
 * `onAddImages` as the reference once stored. A failed one stays, marked,
 * with a retry, rather than a note that points at nothing. Unmounting (closing
 * the editor) cancels whatever is still uploading.
 */
export function useImageUploads(onAddImages: (references: string[]) => void) {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const uploadsRef = useRef<PendingUpload[]>([]);
  uploadsRef.current = uploads;
  const onAddImagesRef = useRef(onAddImages);
  onAddImagesRef.current = onAddImages;

  useEffect(
    () => () => {
      for (const upload of uploadsRef.current) {
        upload.controller.abort();
        URL.revokeObjectURL(upload.preview);
      }
    },
    [],
  );

  const patchUpload = (key: string, patch: Partial<PendingUpload>) =>
    setUploads((list) =>
      list.map((u) => (u.key === key ? { ...u, ...patch } : u)),
    );

  const dropUpload = (key: string) =>
    setUploads((list) => {
      const upload = list.find((u) => u.key === key);
      if (upload) {
        upload.controller.abort();
        URL.revokeObjectURL(upload.preview);
      }
      return list.filter((u) => u.key !== key);
    });

  const runUpload = (upload: PendingUpload) => {
    attachImage(upload.file, {
      signal: upload.controller.signal,
      onProgress: (progress) => patchUpload(upload.key, { progress }),
    })
      .then((stored) => {
        // Closed or removed while it finished: the image belongs to nothing.
        if (upload.controller.signal.aborted) return;
        dropUpload(upload.key);
        onAddImagesRef.current([stored]);
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
  };

  const attachFiles = (files: File[]) => {
    const added = files.map(
      (file): PendingUpload => ({
        key: `${Date.now()}-${Math.random()}`,
        file,
        preview: URL.createObjectURL(file),
        progress: 0,
        failed: false,
        controller: new AbortController(),
      }),
    );
    setUploads((list) => [...list, ...added]);
    for (const upload of added) runUpload(upload);
  };

  const retryUpload = (key: string) => {
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
  };

  return { uploads, attachFiles, retryUpload, dropUpload };
}
