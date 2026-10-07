import type { Note } from "@manifesto/shared";
import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteFontFamilies } from "../colors.js";
import { toggleCheckbox, updateNote } from "../state/index.js";
import { ContentPreview } from "./ContentPreview.js";
import { ImageGallery } from "./ImageGallery.js";
import { LinkPreviewHero } from "./LinkPreviewHero.js";
import { LinkPreviewList } from "./LinkPreviewList.js";
import { ReminderChip } from "./ReminderChip.js";
import { SharedAvatars } from "./SharedAvatars.js";
import { TagChip } from "./TagChip.js";

/**
 * What a card shows of its note: the pictures, then either a link hero (for a
 * note that is nothing but links) or the title, text, previews and chips.
 */
export function NoteCardBody({
  note,
  imagesRef,
  images,
  imagesLoading,
  hasImages,
  isImageOnly,
  isLinkOnly,
  isSquare,
  viewOnly,
  reminderChipRef,
  onToggleReminder,
}: {
  note: Note;
  imagesRef: preact.Ref<HTMLDivElement>;
  images: string[];
  imagesLoading: boolean;
  hasImages: boolean;
  isImageOnly: boolean;
  isLinkOnly: boolean;
  isSquare: boolean;
  viewOnly: boolean;
  reminderChipRef: preact.RefObject<HTMLButtonElement | null>;
  onToggleReminder: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentClipped, setContentClipped] = useState(false);
  const hasLinkPreviews = note.linkPreviews.length > 0;
  const hero = note.linkPreviews[0];

  useEffect(() => {
    const el = contentRef.current;
    if (!el) {
      setContentClipped(false);
      return;
    }
    const update = () => setContentClipped(el.scrollHeight > el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [note.title, note.content, images.length, note.linkPreviews.length]);

  return (
    <>
      {hasImages && (
        <div
          ref={imagesRef}
          class={
            isImageOnly
              ? isSquare
                ? "flex-1 min-h-0"
                : ""
              : "-mx-4 -mt-4 mb-3"
          }
        >
          {imagesLoading ? (
            // Reserved rather than left empty: the masonry grid measures
            // this card, and a picture arriving afterwards would reflow
            // the column under the reader's hands.
            <div
              class={`w-full bg-black/5 dark:bg-white/5 animate-pulse ${isImageOnly && isSquare ? "h-full" : ""}`}
              style={
                isImageOnly && isSquare ? undefined : { aspectRatio: "4 / 3" }
              }
              aria-hidden="true"
            />
          ) : (
            <ImageGallery images={images} fill={isImageOnly && isSquare} />
          )}
        </div>
      )}

      {isLinkOnly && hero ? (
        <>
          <LinkPreviewHero preview={hero} fill={isSquare} />
          {note.linkPreviews.length > 1 && (
            <div class="p-3">
              <LinkPreviewList
                previews={note.linkPreviews.slice(1)}
                variant="card"
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div
            ref={contentRef}
            class={clsx(
              "overflow-hidden",
              contentClipped && "note-content-fade",
              // With nothing to show, an image-only note's text block
              // must not stretch too, or it takes half of a square card
              // from the images.
              isSquare && !isImageOnly ? "flex-1 min-h-0" : "max-h-80",
            )}
            style={{ fontFamily: noteFontFamilies[note.font] || undefined }}
          >
            {note.title && (
              <h3 class="font-medium text-base leading-snug pr-6">
                {note.title}
              </h3>
            )}

            <ContentPreview
              note={note}
              onCheckboxToggle={(lineIndex) =>
                toggleCheckbox(note.id, lineIndex)
              }
              hasTitle={!!note.title}
              readOnly={viewOnly}
            />
          </div>

          {hasLinkPreviews && (
            <div class="mt-3">
              <LinkPreviewList previews={note.linkPreviews} variant="card" />
            </div>
          )}

          {(note.tags.length > 0 || note.reminder || note.sharing) && (
            <div class="mt-3 flex flex-wrap gap-1 items-center">
              {note.reminder && (
                <ReminderChip
                  reminder={note.reminder}
                  anchorRef={reminderChipRef}
                  onClick={onToggleReminder}
                  onClear={() => updateNote(note.id, { reminder: null })}
                />
              )}
              {note.tags.map((tag) => (
                <TagChip key={tag} tag={tag} />
              ))}
              {note.sharing && (
                <span class="ml-auto pl-1">
                  <SharedAvatars note={note} />
                </span>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
