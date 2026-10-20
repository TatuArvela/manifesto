import {
  isTagWithin,
  type Note,
  type NoteColor,
  type NoteFont,
} from "@manifesto/shared";
import { computed, effect, signal } from "@preact/signals";
import { grantedReads, plugins, setPluginError } from "#/autoNotes/registry.ts";
import { runPlugin } from "#/autoNotes/sandbox.ts";
import type { ApproxLabels } from "#/autoNotes/stdlib.ts";
import type { AutoNoteResult, PluginNote } from "#/autoNotes/types.ts";
import { t } from "#/i18n/index.ts";
import { autoNoteOverrides, generatedNoteId } from "./autoNoteOverrides.ts";
import { locale } from "./prefs.ts";

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
 * Manual refresh tick: increase it to run all plugins again. There is no
 * automatic timer. Auto-notes render one time on mount, and then only when the
 * user pushes the refresh button, when plugins change, or when the locale
 * changes.
 */
export const refreshTick = signal(0);

/** Run each enabled plugin again. */
export function refreshAutoNotes(): void {
  refreshTick.value = refreshTick.value + 1;
}

interface RenderedNote {
  pluginId: string;
  pluginName: string;
  result: AutoNoteResult;
  /** Made by a run that read notes. See `drawnWithoutImages`. */
  reading: boolean;
}

/**
 * The notes that all enabled plugins made. The effect below updates it. An
 * array signal, not a computed, because a plugin call is asynchronous.
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

/** How many notes one plugin sees, the most recently changed first. */
export const MAX_NOTES_READ = 500;
/** How much of the text of one note a plugin sees. */
export const MAX_CONTENT_READ = 20_000;

/**
 * The notes of the user, given by `initAutoNotes`. `notesStore` builds on this
 * module (a generated note is a note). Thus, a read from here would be a cycle.
 * Generated notes are not among them. Thus, no plugin reads the output of a
 * different plugin, or its own.
 */
let userNotes: () => Note[] = () => [];

/**
 * The notes of a plugin: the notes that have a tag that it reads or a tag under
 * one, as the notes of a tag are counted in all other places, and not in the
 * trash.
 */
function inScope(tags: string[], all: Note[]): Note[] {
  if (tags.length === 0) return [];
  return all.filter(
    (note) =>
      !note.trashed &&
      note.tags.some((tag) => tags.some((read) => isTagWithin(tag, read))),
  );
}

/** What a plugin sees of them (`ctx.notes`). */
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
 * If a note is the output of a plugin that reads notes. Such a card is drawn
 * without images (`withoutImages`). The sandbox of the plugin has no network.
 * Thus, an image address in what it returns would be the only way to send what
 * it read to a different place.
 *
 * The code asks this of the run that made the card, and also of the current
 * plugin. A card stays after the permission under which it was made, until the
 * next run replaces it. A person pushes Stop on exactly the plugin that they do
 * not trust.
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

/**
 * How long the notes that a plugin reads must stay without change before it
 * runs again. A note that a person types changes at each pause of the
 * auto-save.
 */
const NOTE_CHANGE_SETTLE_MS = 1000;

/**
 * What the reading plugins would see, as text to compare: which notes are in
 * the scope of each, and when each last changed. Empty when nothing reads.
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
 * Connect the effects that run plugins again. They run one time on mount, when
 * plugins change, when the locale changes, or when code calls
 * `refreshAutoNotes()`. For a plugin that reads notes, they also run a moment
 * after a note in its scope changes. `notes` is the own notes of the user (see
 * `userNotes`).
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
    // The first reading is the run for which the effect above just asked. So is
    // a reading that follows a change to the plugins (Allow, Stop).
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
 * Where an auto-note that names no position of its own goes: before each usual
 * note, whose new positions count down from minus the clock. Sufficiently far
 * past that to stay correct as long as the clock does, and well inside the
 * range that a double counts exactly.
 */
const AUTO_NOTE_HEAD = -1e15;

function noteId(rendered: RenderedNote, index: number): string {
  return generatedNoteId(
    rendered.pluginId,
    (rendered.result.key ?? "") || String(index),
  );
}

/** The generated notes made by a run that read notes. */
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
