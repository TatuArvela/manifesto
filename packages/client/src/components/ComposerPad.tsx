import type { NoteColor } from "@manifesto/shared";
import type { RefObject } from "preact";
import { useState } from "preact/hooks";
import { noteColorMap } from "#/colors.ts";
import { type MessageKey, t } from "#/i18n/index.ts";
import { noteQuips, noteSize } from "#/state/prefs.ts";

const ctaKeys: MessageKey[] = [
  "cta.0",
  "cta.1",
  "cta.2",
  "cta.3",
  "cta.4",
  "cta.5",
  "cta.6",
  "cta.7",
  "cta.8",
  "cta.9",
  "cta.10",
  "cta.11",
];

function randomCta(exclude?: string): string {
  const all = ctaKeys.map((k) => t(k));
  const pool = exclude ? all.filter((m) => m !== exclude) : all;
  return pool[Math.floor(Math.random() * pool.length)] ?? "";
}

/**
 * The lines on the top sheet of the pad and on the sheet behind it. `cycle`
 * moves the next line up, and draws a new line behind it.
 */
export function useQuips(): { top: string; next: string; cycle: () => void } {
  const [top, setTop] = useState(() => randomCta());
  const [next, setNext] = useState(() => randomCta(top));
  // The quips come from the rotation only while the preference is on. When it
  // is off, both sheets show the same plain line, and nothing rotates. The code
  // reads it at render, not when it selects a line. Thus, the toggle applies to
  // the stack that is already on the screen.
  const plain = noteQuips.value ? null : t("cta.plain");
  return {
    top: plain ?? top,
    next: plain ?? next,
    cycle: () => {
      setTop(next);
      setNext(randomCta(next));
    },
  };
}

/**
 * The pad of notes from which the composer opens on a wide screen: the top
 * sheet, the sheet behind it that shows the next line, and the base of the
 * stack. Its look is in `styles/composer-pad.css`.
 */
export function ComposerPad({
  isList,
  width,
  stackColor,
  topColor,
  topClass,
  topLine,
  nextLine,
  topSheetRef,
  onOpen,
}: {
  isList: boolean;
  width: number | undefined;
  stackColor: NoteColor;
  topColor: NoteColor;
  topClass: string;
  topLine: string;
  nextLine: string;
  topSheetRef: RefObject<HTMLDivElement | null>;
  onOpen: () => void;
}) {
  return (
    // Slides in and out when the Notes view comes and goes. It does not fade
    // with the other content (hooks/useViewTransition.ts).
    <div
      data-view-slide="composer"
      class={
        isList
          ? noteSize.value === "square"
            ? "max-w-sm mx-auto mb-12 hidden md:block"
            : "mb-12 hidden md:block"
          : "mx-auto mb-12 hidden md:block"
      }
      style={!isList && width ? { width: `${width}px` } : undefined}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: styled card element */}
      <div
        class="note-stack cursor-pointer"
        onClick={onOpen}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter") onOpen();
        }}
      >
        {/* Notes area: top note + next note behind it */}
        <div class="relative">
          <div
            class={`note-stack-next border ${noteColorMap[stackColor].bg} ${noteColorMap[stackColor].border}`}
          >
            <div class="px-5 pt-12 pb-4 text-sm text-neutral-500 dark:text-neutral-300">
              {nextLine}
            </div>
          </div>
          <div
            ref={topSheetRef}
            class={`${topClass} border ${noteColorMap[topColor].bg} ${noteColorMap[topColor].border}`}
          >
            <div class="px-5 pt-12 pb-4 text-sm text-neutral-500 dark:text-neutral-300">
              {topLine}
            </div>
          </div>
        </div>
        <div class={`note-stack-base ${noteColorMap[stackColor].bg}`} />
      </div>
    </div>
  );
}
