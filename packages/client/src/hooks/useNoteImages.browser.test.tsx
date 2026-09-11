import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notes } from "../state/index.js";
import { currentStorage } from "../storage/index.js";
import { useNoteImages } from "./useNoteImages.js";

/**
 * The point of leaving attachments out of a listing is only realised if a card
 * asks for them when it is actually going to draw them. A grid of four hundred
 * notes should fetch the pictures of the handful the reader scrolls past, not
 * of all four hundred — so the fetch hangs off an IntersectionObserver, and
 * these check both halves: nothing while the card is far away, and the bytes
 * once it is near.
 */

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function listed(imageCount: number, images: string[] = []): Note {
  return {
    id: "01JQZK8V000000000000IMGS0",
    title: "Holiday",
    content: "",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images,
    imageCount,
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function Card({ note, spacer }: { note: Note; spacer: number }) {
  const { ref, images, loading } = useNoteImages<HTMLDivElement>(note);
  return (
    <>
      {/* Pushes the card below the fold — `rootMargin` is one viewport, so
          two of them is comfortably out of range. */}
      <div style={{ height: `${spacer}px` }} />
      <div ref={ref} data-testid="images">
        {loading ? "loading" : images.join("|")}
      </div>
    </>
  );
}

let host: HTMLDivElement;
let loadImages: ReturnType<typeof vi.fn>;

const shown = () =>
  host.querySelector('[data-testid="images"]')?.textContent ?? "";

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  localStorage.clear();
  loadImages = vi.fn(async () => [PNG]);
  vi.spyOn(currentStorage, "value", "get").mockReturnValue({
    loadImages,
  } as never);
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.restoreAllMocks();
  notes.value = [];
  localStorage.clear();
});

describe("useNoteImages", () => {
  it("fetches the attachments once the card is near the viewport", async () => {
    const note = listed(1);
    notes.value = [note];
    render(<Card note={note} spacer={0} />, host);
    expect(shown()).toBe("loading");

    await vi.waitFor(() => {
      expect(loadImages).toHaveBeenCalledWith(note.id);
    });
    await vi.waitFor(() => {
      expect(notes.value[0].images).toEqual([PNG]);
    });
  });

  it("fetches nothing for a card that is nowhere near the viewport", async () => {
    const note = listed(1);
    notes.value = [note];
    render(<Card note={note} spacer={window.innerHeight * 5} />, host);

    // Long enough for an observer that was going to fire to have fired.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(loadImages).not.toHaveBeenCalled();
    expect(shown()).toBe("loading");
  });

  it("fetches nothing for a note whose attachments are already in hand", async () => {
    const note = listed(1, [PNG]);
    notes.value = [note];
    render(<Card note={note} spacer={0} />, host);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(loadImages).not.toHaveBeenCalled();
    expect(shown()).toBe(PNG);
  });
});
