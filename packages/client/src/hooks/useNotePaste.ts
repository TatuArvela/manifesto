import { useEffect } from "preact/hooks";
import { extractUrls } from "#/utils/linkPreview.ts";

/**
 * Takes what is pasted while a note is open. Pictures are attached: into the
 * text at the caret when the paste is in the text (`isInText`), and into the
 * header in all other places. The links in text pasted into the body of the
 * note become preview cards. Off while the note is `disabled`.
 *
 * A paste of text and pictures together (from an office document, for
 * example) pastes the text, and its pictures go into the header, as a copy of
 * how the text looked.
 */
export function useNotePaste({
  disabled,
  attachFiles,
  isInText,
  onAddLinkPreviews,
}: {
  disabled: boolean | undefined;
  attachFiles: (files: File[], replaces: undefined, inText: boolean) => void;
  isInText: (target: EventTarget | null) => boolean;
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
      const alone = e.clipboardData.getData("text/plain").trim() === "";
      if (files.length > 0) {
        e.preventDefault();
        // A picture alone (a screenshot, a copied image) is all ours. A
        // copied image also brings an `<img>` with its web address, which the
        // editor would paste as a second image. This listener captures, so
        // the editor never gets it.
        if (alone) e.stopPropagation();
        attachFiles(files, undefined, alone && isInText(e.target));
        return;
      }
      // Only text pasted into the body of the note becomes a card. The listener
      // is on the document. Thus, it also gets a URL pasted into the title, the
      // link box of the toolbar or a tag field, none of which asks for a card.
      if (e.target instanceof HTMLInputElement) return;
      const text = e.clipboardData.getData("text");
      if (text) {
        const urls = extractUrls(text);
        if (urls.length > 0) onAddLinkPreviews(urls);
      }
    };
    document.addEventListener("paste", handlePaste, true);
    return () => document.removeEventListener("paste", handlePaste, true);
  }, [disabled, onAddLinkPreviews, attachFiles, isInText]);
}
