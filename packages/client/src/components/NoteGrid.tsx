import { StickyNote } from "lucide-preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  canReorder,
  noteSize,
  pinnedNotes,
  reorderNotes,
  unpinnedNotes,
  viewMode,
} from "../state/index.js";
import { NoteCard } from "./NoteCard.js";

const MASONRY_GAP = 16; // vertical gap between cards (matches gap-x-4)

/** Measure each child's natural height and set grid-row spans for masonry. */
function applyMasonrySpans(container: HTMLElement | null, isSquare: boolean) {
  if (!container) return;
  const children = Array.from(container.children) as HTMLElement[];
  // Give each card enough room to expand to its natural height
  for (const child of children) {
    child.style.gridRowEnd = "span 9999";
  }
  // Now measure actual rendered heights and set correct spans
  const heights = children.map((child) => {
    if (isSquare) return child.getBoundingClientRect().width;
    return child.getBoundingClientRect().height;
  });
  for (let i = 0; i < children.length; i++) {
    children[i].style.gridRowEnd =
      `span ${Math.ceil(heights[i] + MASONRY_GAP)}`;
  }
}

/** Find the nearest gap index for a drag event in a 2D grid or 1D list. */
function findNearestGap(
  e: DragEvent,
  container: HTMLElement,
  isList: boolean,
): number {
  const children = Array.from(container.children) as HTMLElement[];
  if (children.length === 0) return 0;

  if (isList) {
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) return i;
    }
    return children.length;
  }

  // 2D grid/masonry: find nearest card by distance to center
  let nearestIdx = 0;
  let nearestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < children.length; i++) {
    const rect = children[i].getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestIdx = i;
    }
  }

  // Before or after the nearest card, based on horizontal position
  const rect = children[nearestIdx].getBoundingClientRect();
  return e.clientX < rect.left + rect.width / 2 ? nearestIdx : nearestIdx + 1;
}

export function NoteGrid() {
  const pinned = pinnedNotes.value;
  const unpinned = unpinnedNotes.value;
  const reorderable = canReorder.value;
  const isSquare = noteSize.value === "square";
  const isList = viewMode.value === "list";

  const [dropGap, setDropGap] = useState<number | null>(null);
  const [dropSection, setDropSection] = useState<"pinned" | "unpinned" | null>(
    null,
  );
  const dragSourceId = useRef<string | null>(null);
  const dragSection = useRef<"pinned" | "unpinned" | null>(null);
  const pinnedGridRef = useRef<HTMLDivElement>(null);
  const unpinnedGridRef = useRef<HTMLDivElement>(null);

  // Apply masonry layout (runs before paint)
  useLayoutEffect(() => {
    if (isList) return;
    applyMasonrySpans(pinnedGridRef.current, isSquare);
    applyMasonrySpans(unpinnedGridRef.current, isSquare);
  }, [pinned, unpinned, isList, isSquare]);

  // Recalculate masonry when container width changes (window resize, sidebar toggle)
  useEffect(() => {
    if (isList) return;
    const containers = [pinnedGridRef.current, unpinnedGridRef.current].filter(
      (c): c is HTMLDivElement => c !== null,
    );
    if (containers.length === 0) return;

    const widths = new Map<Element, number>();
    for (const c of containers) widths.set(c, c.clientWidth);

    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const prev = widths.get(entry.target);
        const now = entry.contentRect.width;
        if (prev !== now) {
          widths.set(entry.target, now);
          changed = true;
        }
      }
      if (changed) {
        applyMasonrySpans(pinnedGridRef.current, isSquare);
        applyMasonrySpans(unpinnedGridRef.current, isSquare);
      }
    });

    for (const c of containers) observer.observe(c);
    return () => observer.disconnect();
  }, [isList, isSquare]);

  const getSourceIndex = (section: "pinned" | "unpinned") => {
    const list = section === "pinned" ? pinned : unpinned;
    return list.findIndex((n) => n.id === dragSourceId.current);
  };

  const handleDragStart = (
    e: DragEvent,
    id: string,
    section: "pinned" | "unpinned",
  ) => {
    if (!reorderable) return;
    dragSourceId.current = id;
    dragSection.current = section;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
    const target = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => target.classList.add("note-dragging"));
  };

  const handleDragEnd = (e: DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.classList.remove("note-dragging");
    dragSourceId.current = null;
    dragSection.current = null;
    setDropGap(null);
    setDropSection(null);
  };

  const handleGridDragOver = (e: DragEvent, section: "pinned" | "unpinned") => {
    if (!reorderable || dragSection.current !== section) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }

    const container =
      section === "pinned" ? pinnedGridRef.current : unpinnedGridRef.current;
    if (!container) return;

    const gap = findNearestGap(e, container, isList);

    const srcIdx = getSourceIndex(section);
    if (srcIdx !== -1 && (gap === srcIdx || gap === srcIdx + 1)) {
      setDropGap(null);
      setDropSection(null);
      return;
    }

    setDropGap(gap);
    setDropSection(section);
  };

  const handleGridDragLeave = (
    e: DragEvent,
    section: "pinned" | "unpinned",
  ) => {
    const container =
      section === "pinned" ? pinnedGridRef.current : unpinnedGridRef.current;
    if (
      container &&
      e.relatedTarget instanceof Node &&
      container.contains(e.relatedTarget)
    ) {
      return;
    }
    setDropGap(null);
    setDropSection(null);
  };

  const handleDrop = (e: DragEvent, section: "pinned" | "unpinned") => {
    e.preventDefault();
    const sourceId = dragSourceId.current;
    const gap = dropGap;
    setDropGap(null);
    setDropSection(null);
    if (!sourceId || gap === null || dragSection.current !== section) return;

    const list = section === "pinned" ? pinned : unpinned;
    const ids = list.map((n) => n.id);
    const fromIndex = ids.indexOf(sourceId);
    if (fromIndex === -1) return;

    const toIndex = gap > fromIndex ? gap - 1 : gap;
    if (toIndex !== fromIndex) {
      reorderNotes(ids, fromIndex, toIndex);
    }
  };

  if (pinned.length === 0 && unpinned.length === 0) {
    return (
      <div class="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-600">
        <StickyNote class="w-12 h-12 mb-4" />
        <p class="text-lg">No notes yet</p>
        <p class="text-sm">Time to jot something down!</p>
      </div>
    );
  }

  const gridClass = isList
    ? "flex flex-col gap-3"
    : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-x-4 items-start";
  const gridStyle = isList ? undefined : { gridAutoRows: "1px" };
  const wrapperClass = "";
  const headingClass =
    "text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 mb-2 px-1";

  const getDropSide = (idx: number, section: "pinned" | "unpinned") => {
    if (dropSection !== section || dropGap === null) return undefined;
    const list = section === "pinned" ? pinned : unpinned;
    if (dropGap === list.length && idx === list.length - 1) return "after";
    if (dropGap === idx) return "before";
    return undefined;
  };

  return (
    <div class={`mt-4 ${wrapperClass}`}>
      {pinned.length > 0 && (
        <section>
          <h2 class={headingClass}>Pinned</h2>
          {/* biome-ignore lint/a11y/useSemanticElements: grid layout requires div */}
          <div
            ref={pinnedGridRef}
            role="list"
            class={gridClass}
            style={gridStyle}
            onDragOver={(e) => handleGridDragOver(e, "pinned")}
            onDragLeave={(e) => handleGridDragLeave(e, "pinned")}
            onDrop={(e) => handleDrop(e, "pinned")}
          >
            {pinned.map((note, idx) => (
              <NoteCard
                key={note.id}
                note={note}
                draggable={reorderable}
                onDragStart={(e) => handleDragStart(e, note.id, "pinned")}
                onDragEnd={handleDragEnd}
                dropSide={getDropSide(idx, "pinned")}
              />
            ))}
          </div>
        </section>
      )}

      {pinned.length > 0 && unpinned.length > 0 && (
        <h2 class={`${headingClass} mt-6`}>Others</h2>
      )}

      {unpinned.length > 0 && (
        <section>
          {/* biome-ignore lint/a11y/useSemanticElements: grid layout requires div */}
          <div
            ref={unpinnedGridRef}
            role="list"
            class={gridClass}
            style={gridStyle}
            onDragOver={(e) => handleGridDragOver(e, "unpinned")}
            onDragLeave={(e) => handleGridDragLeave(e, "unpinned")}
            onDrop={(e) => handleDrop(e, "unpinned")}
          >
            {unpinned.map((note, idx) => (
              <NoteCard
                key={note.id}
                note={note}
                draggable={reorderable}
                onDragStart={(e) => handleDragStart(e, note.id, "unpinned")}
                onDragEnd={handleDragEnd}
                dropSide={getDropSide(idx, "unpinned")}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
