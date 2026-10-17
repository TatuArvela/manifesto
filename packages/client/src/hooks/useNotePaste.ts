import { useEffect } from "preact/hooks";
import { extractUrls } from "#/utils/linkPreview.ts";

/**
 * Takes what is pasted while a note is open: pictures are attached, and the
 * links in text pasted into the note's body become preview cards. Off while
 * the note is `disabled`.
 */
export function useNotePaste({
  disabled,
  attachFiles,
  onAddLinkPreviews,
}: {
  disabled: boolean | undefined;
  attachFiles: (files: File[]) => void;
  onAddLinkPreviews: (urls: string[]) => void;
}): void {
  useEffect(() => {
    if (disabled) return;
    const handlePaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      const files = [...e.clipboardData.items]
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length > 0) {
        e.preventDefault();
        attachFiles(files);
        return;
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
  }, [disabled, onAddLinkPreviews, attachFiles]);
}
