import { TRASH_RETENTION_DAYS } from "@manifesto/shared";
import type { JSX } from "preact";
import { boardCard } from "#/components/boardCard.ts";
import { plural, t } from "#/i18n/index.ts";
import { type AppView, activeTag } from "#/state/ui.ts";

/**
 * A board with nothing on it: a drawing of the contents of the view when it has
 * contents (a stack of notes, a tidy archive box, an empty bin), with a line
 * that tells why it is empty and how something comes here. It is on its own
 * card. Thus, it stays legible over a board picture or a busy texture. You
 * cannot select it, because it is a message, not content.
 */
export function EmptyBoard({
  view,
  hiddenByTag,
}: {
  view: AppView;
  /**
   * Notes that a hidden tag keeps out of the Notes view. That is not "none".
   */
  hiddenByTag: number;
}) {
  const { Drawing, title, hint } = emptyStateFor(view, activeTag.value);
  return (
    <div class="flex justify-center py-16">
      <div
        class={`flex flex-col items-center text-center select-none max-w-sm px-10 py-8 ${boardCard} text-neutral-500 dark:text-neutral-400`}
      >
        <Drawing />
        {hiddenByTag > 0 ? (
          <p class="text-sm">{plural("noteGrid.hiddenByTag", hiddenByTag)}</p>
        ) : (
          <>
            <p class="text-lg text-neutral-700 dark:text-neutral-200">
              {title}
            </p>
            <p class="text-sm">{hint}</p>
          </>
        )}
      </div>
    </div>
  );
}

function emptyStateFor(
  view: AppView,
  tag: string | null,
): { Drawing: () => JSX.Element; title: string; hint: string } {
  switch (view) {
    case "search":
      return {
        Drawing: SearchDrawing,
        title: t("search.empty"),
        hint: t("search.emptyHint"),
      };
    case "archived":
      return {
        Drawing: ArchiveDrawing,
        title: t("empty.archive.title"),
        hint: t("empty.archive.hint"),
      };
    case "trash":
      return {
        Drawing: TrashDrawing,
        title: t("empty.trash.title"),
        hint: plural("empty.trash.hint", TRASH_RETENTION_DAYS),
      };
    case "reminders":
      return {
        Drawing: ReminderDrawing,
        title: t("empty.reminders.title"),
        hint: t("empty.reminders.hint"),
      };
    default:
      // The notes, or the notes of one tag, in the Notes view or the Tags view.
      return tag
        ? {
            Drawing: TagDrawing,
            title: t("empty.tag.title", { tag }),
            hint: t("empty.tag.hint"),
          }
        : notesState();
  }
}

function notesState() {
  return {
    Drawing: NotesDrawing,
    title: t("noteGrid.empty"),
    hint: t("noteGrid.emptyHint"),
  };
}

/**
 * The frame of all drawings: lines in the text color, and fills of the same
 * color at low opacity. Thus, each one is legible in both themes and on all
 * note colors, without its own palette.
 */
function Drawing({ children }: { children: preact.ComponentChildren }) {
  return (
    <svg
      viewBox="0 0 120 120"
      class="w-28 h-28 mb-4"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A small sparkle with four points, centered on (x, y). */
function Sparkle({ x, y, size = 5 }: { x: number; y: number; size?: number }) {
  return (
    <path
      d={`M${x} ${y - size}v${size * 2}M${x - size} ${y}h${size * 2}`}
      stroke-width="2"
    />
  );
}

/** A pad of sticky notes, with the top note blank, and a pencil next to it. */
function NotesDrawing() {
  return (
    <Drawing>
      <rect
        x="24"
        y="34"
        width="58"
        height="58"
        rx="3"
        transform="rotate(-8 53 63)"
        fill="currentColor"
        fill-opacity="0.07"
        stroke-opacity="0.5"
      />
      <rect
        x="28"
        y="28"
        width="58"
        height="58"
        rx="3"
        fill="currentColor"
        fill-opacity="0.12"
      />
      <path
        d="M38 44h30M38 54h22"
        stroke-opacity="0.4"
        stroke-dasharray="1 6"
      />
      <path
        d="M78 98l22-22 6 6-22 22h-6z"
        fill="currentColor"
        fill-opacity="0.12"
      />
      <path d="M94 82l6 6" />
      <Sparkle x={98} y={30} />
    </Drawing>
  );
}

/** An archive box with its lid on, tidy. */
function ArchiveDrawing() {
  return (
    <Drawing>
      <path
        d="M28 52h64v38a4 4 0 0 1-4 4H32a4 4 0 0 1-4-4z"
        fill="currentColor"
        fill-opacity="0.08"
      />
      <rect
        x="22"
        y="38"
        width="76"
        height="14"
        rx="3"
        fill="currentColor"
        fill-opacity="0.16"
      />
      <path d="M50 66h20" stroke-width="4" />
      <path d="M36 102h48" stroke-opacity="0.3" />
      <Sparkle x={102} y={26} />
      <Sparkle x={18} y={24} size={3.5} />
    </Drawing>
  );
}

/** A waste bin with nothing in it, with its lid straight. */
function TrashDrawing() {
  return (
    <Drawing>
      <path
        d="M36 44l5 50a5 5 0 0 0 5 4.5h28a5 5 0 0 0 5-4.5l5-50z"
        fill="currentColor"
        fill-opacity="0.08"
      />
      <path d="M28 40h64" />
      <path d="M50 40v-6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6" />
      <path d="M52 56v30M68 56v30" stroke-opacity="0.45" />
      <path d="M30 108h60" stroke-opacity="0.3" />
      <Sparkle x={100} y={30} />
      <Sparkle x={20} y={54} size={3.5} />
    </Drawing>
  );
}

/** An alarm clock that is quiet. */
function ReminderDrawing() {
  return (
    <Drawing>
      <circle cx="60" cy="64" r="28" fill="currentColor" fill-opacity="0.08" />
      <path d="M60 48v16l10 6" />
      <path d="M30 40a10 10 0 0 1 14-12M90 40a10 10 0 0 0-14-12" />
      <path d="M42 88l-6 8M78 88l6 8" />
      <path d="M40 104h40" stroke-opacity="0.3" />
      <Sparkle x={100} y={58} size={3.5} />
    </Drawing>
  );
}

/** A luggage tag on its string, with nothing written on it. */
function TagDrawing() {
  return (
    <Drawing>
      <path
        d="M28 40h36l28 28-26 26-38-38z"
        fill="currentColor"
        fill-opacity="0.1"
      />
      <circle cx="42" cy="52" r="4" />
      <path d="M42 48c-6-14 4-26 18-22" stroke-opacity="0.5" />
      <path
        d="M58 70h14M54 78h10"
        stroke-opacity="0.4"
        stroke-dasharray="1 6"
      />
      <Sparkle x={98} y={34} />
    </Drawing>
  );
}

/** A magnifying glass over nothing yet. */
function SearchDrawing() {
  return (
    <Drawing>
      <circle cx="52" cy="52" r="24" fill="currentColor" fill-opacity="0.08" />
      <path d="M70 70l22 22" stroke-width="6" />
      <path d="M40 46a14 14 0 0 1 10-8" stroke-opacity="0.5" />
      <Sparkle x={96} y={30} />
      <Sparkle x={24} y={92} size={3.5} />
    </Drawing>
  );
}
