import { hasUnloadedImages, imageCountOf, type Note } from "@manifesto/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { ensureImages } from "#/state/notesStore.ts";

/**
 * The attachments of a note, loaded when the card that contains them comes into
 * view.
 *
 * Server listings do not include the bytes (they are almost all of a note, and
 * nobody looks at most of them). Thus, a card knows only how many it has. It
 * asks for them when it is near the screen, which makes the saving real: a grid
 * of four hundred notes downloads the attachments of the dozen past which the
 * user really scrolls.
 *
 * `rootMargin` starts the fetch one screen early. Thus, in usual scrolling, the
 * image is there when the card is.
 *
 * Returns the ref to put on the element to watch, and the current images, empty
 * while they are still on their way.
 */
export function useNoteImages<T extends HTMLElement>(note: Note) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  const count = imageCountOf(note);
  const pending = hasUnloadedImages(note);

  useEffect(() => {
    if (!pending || inView) return;
    const element = ref.current;
    if (!element) return;
    // No IntersectionObserver (jsdom, an old engine): get the attachment, so
    // that it shows.
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100%" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [pending, inView]);

  useEffect(() => {
    if (inView && pending) void ensureImages(note.id);
  }, [inView, pending, note.id]);

  return { ref, images: note.images, count, loading: pending };
}
