import { hasUnloadedImages, imageCountOf, type Note } from "@manifesto/shared";
import { useEffect, useRef, useState } from "preact/hooks";
import { ensureImages } from "../state/index.js";

/**
 * A note's attachments, fetched when the card carrying them comes into view.
 *
 * Server listings leave the bytes behind — they are almost all of a note, and
 * most of them are never looked at — so a card knows only how many it has. It
 * asks for them when it is close to being on screen, which is what makes the
 * saving real: a grid of four hundred notes downloads the attachments of the
 * dozen the user actually scrolls past.
 *
 * `rootMargin` starts the fetch a screen early, so in ordinary scrolling the
 * image is there by the time the card is.
 *
 * Returns the ref to put on the element to watch, and the images as they
 * stand — empty while they are still on their way.
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
    // No IntersectionObserver (jsdom, an old engine): fetch rather than never
    // show the attachment.
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
