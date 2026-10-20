import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notes } from "#/state/notesStore.ts";
import { currentStorage } from "#/storage/index.ts";
import { useNoteImages } from "./useNoteImages.ts";

/**
 * The removal of attachments from a listing only helps if a card asks for them
 * when it will really draw them. A grid of four hundred notes must get the
 * pictures of the few cards past which the reader scrolls, not of all four
 * hundred. Thus, the fetch comes from an IntersectionObserver, and these tests
 * check both halves: nothing while the card is far away, and the bytes when it
 * is near.
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
      {/* Pushes the card below the fold. `rootMargin` is one viewport, so
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
      expect(notes.value[0]?.images).toEqual([PNG]);
    });
  });

  it("fetches nothing for a card that is nowhere near the viewport", async () => {
    const note = listed(1);
    notes.value = [note];
    render(<Card note={note} spacer={window.innerHeight * 5} />, host);

    // Sufficiently long for an observer that was to fire to have fired.
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
