import DOMPurify from "dompurify";
import { useEffect, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import type { SharedNotePayload } from "../sharing.js";
import { clearShareHash } from "../sharing.js";
import { createNote } from "../state/actions.js";
import { showError, showSuccess } from "../state/ui.js";
import { renderMarkdown } from "../utils/remarkRenderer.js";

export function SharedNoteDialog({
  payload,
  onDone,
}: {
  payload: SharedNotePayload;
  onDone: () => void;
}) {
  const [closing, setClosing] = useState(false);
  const colors = noteColorMap[payload.color];

  const dismiss = () => {
    setClosing(true);
    setTimeout(() => {
      clearShareHash();
      onDone();
    }, 150);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const handleSave = async () => {
    try {
      await createNote({
        title: payload.title,
        content: payload.content,
        color: payload.color,
        font: payload.font,
        tags: [...payload.tags],
      });
      showSuccess("Note saved!");
      clearShareHash();
      onDone();
    } catch {
      showError("Failed to save shared note.");
    }
  };

  const contentHtml = payload.content
    ? DOMPurify.sanitize(renderMarkdown(payload.content))
    : "";

  return (
    <>
      {/* Backdrop */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss */}
      <div
        class={`fixed inset-0 bg-black/50 z-40 transition-opacity duration-150 ${closing ? "opacity-0" : "animate-fade-in"}`}
        onClick={dismiss}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shared-note-dialog-title"
        class={`fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none transition-all duration-150 ${closing ? "opacity-0 scale-95" : "animate-scale-in"}`}
      >
        <div class="pointer-events-auto w-full max-w-lg max-h-full overflow-y-auto overscroll-contain">
          <div
            class={`${colors.bg} ${colors.border} border rounded-lg shadow-xl overflow-hidden`}
          >
            {/* Header */}
            <div class="px-5 pt-5 pb-3">
              <p
                id="shared-note-dialog-title"
                class="text-sm text-neutral-500 dark:text-neutral-400 mb-3"
              >
                Someone shared a note with you
              </p>

              {/* Note preview */}
              <div class="max-h-80 overflow-y-auto">
                {payload.title && (
                  <h3
                    class="font-medium text-base leading-snug mb-2"
                    style={{
                      fontFamily: noteFontFamilies[payload.font] || undefined,
                    }}
                  >
                    {payload.title}
                  </h3>
                )}

                {contentHtml && (
                  <div
                    class="prose prose-sm dark:prose-invert max-w-none text-sm text-neutral-600 dark:text-neutral-300"
                    style={{
                      fontFamily: noteFontFamilies[payload.font] || undefined,
                    }}
                    dangerouslySetInnerHTML={{ __html: contentHtml }}
                  />
                )}

                {payload.tags.length > 0 && (
                  <div class="flex flex-wrap gap-1 mt-3">
                    {payload.tags.map((tag) => (
                      <span
                        key={tag}
                        class="inline-block px-2 py-0.5 text-xs rounded-full bg-neutral-200/60 dark:bg-neutral-700/60"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div class="px-5 py-3 flex justify-end gap-2 border-t border-neutral-200/50 dark:border-neutral-700/50">
              <button
                type="button"
                class="px-4 py-2 text-sm rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                onClick={dismiss}
              >
                Discard
              </button>
              <button
                type="button"
                class="px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                onClick={handleSave}
              >
                Save to my notes
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
