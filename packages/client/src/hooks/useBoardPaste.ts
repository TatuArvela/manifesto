import { useEffect } from "preact/hooks";
import { imagesForNote, startNoteWith } from "#/state/incomingShare.ts";
import { hasOpenLayer, isTypingTarget } from "./useShortcut.ts";

/**
 * A paste on the board itself, with no note open and nothing to type in,
 * starts a new note from the clipboard: its text as the note's text, its
 * pictures attached. A paste anywhere else (a field, an open note, a dialog)
 * is left to that, by the same rule the single-key shortcuts follow.
 */
export function useBoardPaste(): void {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || !e.clipboardData) return;
      if (isTypingTarget(e.target) || hasOpenLayer()) return;
      const files = [...e.clipboardData.items]
        .filter(
          (item) => item.kind === "file" && item.type.startsWith("image/"),
        )
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null);
      const text = e.clipboardData.getData("text/plain").trim();
      if (files.length === 0 && !text) return;
      e.preventDefault();
      void (async () => {
        const images = await imagesForNote(
          files.map((file) => ({ blob: file, name: file.name })),
        );
        startNoteWith(text, images);
      })();
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);
}
