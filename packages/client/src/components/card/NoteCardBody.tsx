import type { Note } from "@manifesto/shared";
import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteFontFamilies } from "#/colors.ts";
import { ContentPreview } from "#/components/ContentPreview.tsx";
import { ImageGallery } from "#/components/ImageGallery.tsx";
import { LinkPreviewHero } from "#/components/LinkPreviewHero.tsx";
import { LinkPreviewList } from "#/components/LinkPreviewList.tsx";
import { ReminderChip } from "#/components/ReminderChip.tsx";
import { SharedAvatars } from "#/components/sharing/SharedAvatars.tsx";
import { TagChip } from "#/components/TagChip.tsx";
import { t } from "#/i18n/index.ts";
import { toggleCheckbox } from "#/state/actions.ts";
import { drawnWithoutImages } from "#/state/autoNotes.ts";
import { updateNote } from "#/state/notesStore.ts";
import { checklistProgress as showChecklistProgress } from "#/state/prefs.ts";
import { checklistProgress } from "#/utils/markdown.ts";

/**
 * How far along a note's checklists are, as a thin bar under the text. Drawn
 * from two items on: one item is either done or not, which its box says.
 */
function ChecklistProgress({ content }: { content: string }) {
  const { done, total } = checklistProgress(content);
  if (total < 2) return null;
  const label = t("card.checklistProgress", {
    done: String(done),
    total: String(total),
  });
  return (
    <div
      class="mt-2 h-1 rounded-full bg-black/10 dark:bg-white/15 overflow-hidden"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={label}
      title={label}
    >
      <div
        class="h-full rounded-full bg-current opacity-50 transition-[width] duration-300"
        style={{ width: `${(done / total) * 100}%` }}
      />
    </div>
  );
}

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
  reminderOpen,
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
  /** Whether the reminder picker is open, for the chip's `aria-expanded`. */
  reminderOpen: boolean;
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
            <ImageGallery
              images={images}
              alts={note.imageAlts}
              fill={isImageOnly && isSquare}
            />
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
              noImages={drawnWithoutImages(note)}
            />
          </div>

          {showChecklistProgress.value && (
            <ChecklistProgress content={note.content} />
          )}

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
                  expanded={reminderOpen}
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
