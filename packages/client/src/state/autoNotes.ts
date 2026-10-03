import {
  isTagWithin,
  type Note,
  type NoteColor,
  type NoteFont,
} from "@manifesto/shared";
import { computed, effect, signal } from "@preact/signals";
import {
  grantedReads,
  plugins,
  setPluginError,
} from "../autoNotes/registry.js";
import { runPlugin } from "../autoNotes/sandbox.js";
import type { ApproxLabels } from "../autoNotes/stdlib.js";
import type { AutoNoteResult, PluginNote } from "../autoNotes/types.js";
import { t } from "../i18n/index.js";
import { autoNoteOverrides, generatedNoteId } from "./autoNoteOverrides.js";
import { locale } from "./prefs.js";

function buildApproxLabels(): ApproxLabels {
  return {
    today: t("autoNotes.approx.today"),
    tomorrow: t("autoNotes.approx.tomorrow"),
    dayAfterTomorrow: t("autoNotes.approx.dayAfterTomorrow"),
    yesterday: t("autoNotes.approx.yesterday"),
    inNDays: t("autoNotes.approx.inNDays"),
    inAWeek: t("autoNotes.approx.inAWeek"),
    inNWeeks: t("autoNotes.approx.inNWeeks"),
    underNWeeks: t("autoNotes.approx.underNWeeks"),
    inAMonth: t("autoNotes.approx.inAMonth"),
    nDaysAgo: t("autoNotes.approx.nDaysAgo"),
    aWeekAgo: t("autoNotes.approx.aWeekAgo"),
    nWeeksAgo: t("autoNotes.approx.nWeeksAgo"),
    underNWeeksAgo: t("autoNotes.approx.underNWeeksAgo"),
    aMonthAgo: t("autoNotes.approx.aMonthAgo"),
  };
}

/**
 * Manual refresh tick: increment to re-invoke all plugins. There is no
 * automatic timer; auto-notes render once on mount and then only when the
 * user hits the refresh button, plugins change, or the locale changes.
 */
export const refreshTick = signal(0);

/** Force-rerun every enabled plugin. */
export function refreshAutoNotes(): void {
  refreshTick.value = refreshTick.value + 1;
}

interface RenderedNote {
  pluginId: string;
  pluginName: string;
  result: AutoNoteResult;
  /** Made by a run that was reading notes, see `drawnWithoutImages`. */
  reading: boolean;
}

/**
 * Materialized notes for all enabled plugins. Updated by the effect below.
 * An array signal rather than a computed because plugin invocation is async.
 */
export const autoNotes = signal<RenderedNote[]>([]);

function buildErrorNote(
  pluginId: string,
  pluginName: string,
  message: string,
  reading: boolean,
): RenderedNote {
  return {
    pluginId,
    pluginName,
    reading,
    result: {
      title: `⚠ ${pluginName}`,
      content: `Plugin failed:\n\n\`\`\`\n${message}\n\`\`\``,
    },
  };
}

/** How many notes one plugin is shown, the most recently changed first. */
export const MAX_NOTES_READ = 500;
/** How much of one note's text a plugin is shown. */
export const MAX_CONTENT_READ = 20_000;

/**
 * The user's notes, handed in by `initAutoNotes`: `notesStore` builds on this
 * module (a generated note is a note), so reading it from here would be a
 * cycle. Generated notes are not among them, so no plugin reads another's
 * output, or its own.
 */
let userNotes: () => Note[] = () => [];

/**
 * A plugin's notes: those carrying a tag it reads or a tag under one, as a
 * tag's notes are counted everywhere else, and not in the trash.
 */
function inScope(tags: string[], all: Note[]): Note[] {
  if (tags.length === 0) return [];
  return all.filter(
    (note) =>
      !note.trashed &&
      note.tags.some((tag) => tags.some((read) => isTagWithin(tag, read))),
  );
}

/** What a plugin is shown of them (`ctx.notes`). */
export function notesFor(tags: string[], all: Note[]): PluginNote[] {
  return inScope(tags, all)
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, MAX_NOTES_READ)
    .map((note) => ({
      id: note.id,
      title: note.title,
      content: note.content.slice(0, MAX_CONTENT_READ),
      tags: [...note.tags],
      color: note.color,
      pinned: note.pinned,
      archived: note.archived,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    }));
}

/**
 * Whether a note is the output of a plugin that reads notes. Such a card is
 * drawn without images (`withoutImages`): the plugin's sandbox has no network,
 * so an image address in what it returns would be the one way to send what it
 * read somewhere.
 *
 * Asked of the run that made the card as well as of the plugin as it stands:
 * a card outlives the allowance it was made under, until the next run
 * replaces it, and Stop is pressed on exactly the plugin not to be trusted.
 */
export function drawnWithoutImages(note: Pick<Note, "id" | "source">): boolean {
  if (note.source?.kind !== "auto-note") return false;
  if (madeReading.value.has(note.id)) return true;
  const { pluginId } = note.source;
  const plugin = plugins.value.find((p) => p.id === pluginId);
  return plugin !== undefined && grantedReads(plugin).length > 0;
}

async function runAll() {
  const snapshot = plugins.value;
  const held = userNotes();
  const today = new Date().toISOString();
  const loc = locale.value;
  const approxLabels = buildApproxLabels();
  const out: RenderedNote[] = [];
  for (const plugin of snapshot) {
    if (!plugin.enabled) continue;
    const src = plugin.origin.source;
    if (!src) continue;
    const reads = grantedReads(plugin);
    const reading = reads.length > 0;
    try {
      const results = await runPlugin(src, {
        today,
        locale: loc,
        approxLabels,
        reads,
        notes: notesFor(reads, held),
      });
      setPluginError(plugin.id, undefined);
      for (const result of results) {
        out.push({
          pluginId: plugin.id,
          pluginName: plugin.name,
          result,
          reading,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPluginError(plugin.id, message);
      out.push(buildErrorNote(plugin.id, plugin.name, message, reading));
    }
  }
  autoNotes.value = out;
}

let runningPromise: Promise<void> | null = null;
let rerunRequested = false;

function scheduleRun() {
  if (runningPromise) {
    rerunRequested = true;
    return;
  }
  runningPromise = runAll().finally(() => {
    runningPromise = null;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleRun();
    }
  });
}

let disposer: (() => void) | null = null;

/** How long the notes a plugin reads must rest before it runs again: a
 * note being typed changes with every pause of the auto-save. */
const NOTE_CHANGE_SETTLE_MS = 1000;

/**
 * What the reading plugins would see, as text to compare: which notes are in
 * each one's scope and when each last changed. Empty when nothing reads.
 */
function scopeSignature(all: Note[]): string {
  return plugins.value
    .filter((plugin) => plugin.enabled)
    .map((plugin) => {
      const reads = grantedReads(plugin);
      if (reads.length === 0) return "";
      return inScope(reads, all)
        .map((note) => `${note.id}@${note.updatedAt}`)
        .join(",");
    })
    .join("|");
}

/**
 * Wire up the effects that re-invoke plugins. They run once on mount, when
 * plugins change, the locale changes or `refreshAutoNotes()` is called, and,
 * for a plugin that reads notes, a moment after a note in its scope changes.
 * `notes` is the user's own notes (see `userNotes`).
 */
export function initAutoNotes(notes: () => Note[] = () => []): () => void {
  if (disposer) return disposer;
  userNotes = notes;

  const stopEffect = effect(() => {
    void plugins.value;
    void locale.value;
    void refreshTick.value;
    scheduleRun();
  });

  let lastSignature: string | null = null;
  let lastPlugins = plugins.value;
  let settle: ReturnType<typeof setTimeout> | null = null;
  const stopScopeEffect = effect(() => {
    const signature = scopeSignature(notes());
    const samePlugins = plugins.value === lastPlugins;
    lastPlugins = plugins.value;
    // The first reading is the run the effect above has just asked for, and
    // so is one that follows a change to the plugins (Allow, Stop).
    if (lastSignature === null || signature === lastSignature || !samePlugins) {
      lastSignature = signature;
      return;
    }
    lastSignature = signature;
    if (settle) clearTimeout(settle);
    settle = setTimeout(scheduleRun, NOTE_CHANGE_SETTLE_MS);
  });

  disposer = () => {
    stopEffect();
    stopScopeEffect();
    if (settle) clearTimeout(settle);
    userNotes = () => [];
    disposer = null;
  };
  return disposer;
}

const DEFAULT_COLOR = "default" as NoteColor;
const DEFAULT_FONT = "default" as NoteFont;

/**
 * Where an auto-note that names no position of its own goes: ahead of every
 * ordinary note, whose new positions count down from minus the clock. Far
 * enough past that to hold for as long as the clock does, and well inside the
 * range a double counts exactly.
 */
const AUTO_NOTE_HEAD = -1e15;

function noteId(rendered: RenderedNote, index: number): string {
  return generatedNoteId(
    rendered.pluginId,
    (rendered.result.key ?? "") || String(index),
  );
}

/** The generated notes made by a run that was reading notes. */
const madeReading = computed<Set<string>>(
  () =>
    new Set(
      autoNotes.value.flatMap((rendered, index) =>
        rendered.reading ? [noteId(rendered, index)] : [],
      ),
    ),
);

function toNote(rendered: RenderedNote, index: number): Note {
  const { result, pluginId } = rendered;
  const noteKey = result.key ?? "";
  const id = noteId(rendered, index);
  const override = autoNoteOverrides.value[id];
  const now = new Date().toISOString();
  return {
    id,
    title: result.title,
    content: result.content,
    color: override?.color ?? result.color ?? DEFAULT_COLOR,
    font: result.font ?? DEFAULT_FONT,
    pinned: override?.pinned ?? result.pinned ?? false,
    archived: override?.archived ?? false,
    trashed: override?.trashed ?? false,
    trashedAt: override?.trashedAt ?? null,
    position: override?.position ?? result.position ?? AUTO_NOTE_HEAD - index,
    tags: override?.tags ?? result.tags ?? [],
    images: [],
    linkPreviews: [],
    reminder: override?.reminder ?? null,
    createdAt: now,
    updatedAt: now,
    readonly: true,
    source: { kind: "auto-note", pluginId, noteKey },
  };
}

export const generatedNotes = computed<Note[]>(() =>
  autoNotes.value.map((r, i) => toNote(r, i)),
);
