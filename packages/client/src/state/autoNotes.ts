import type { Note, NoteColor, NoteFont } from "@manifesto/shared";
import { computed, effect, signal } from "@preact/signals";
import { plugins, setPluginError } from "../autoNotes/registry.js";
import { runPlugin } from "../autoNotes/sandbox.js";
import type { ApproxLabels } from "../autoNotes/stdlib.js";
import type { AutoNoteResult } from "../autoNotes/types.js";
import { t } from "../i18n/index.js";
import { autoNoteOverrides } from "./autoNoteOverrides.js";
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
 * Manual refresh tick — increment to re-invoke all plugins. There is no
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
): RenderedNote {
  return {
    pluginId,
    pluginName,
    result: {
      title: `⚠ ${pluginName}`,
      content: `Plugin failed:\n\n\`\`\`\n${message}\n\`\`\``,
    },
  };
}

async function runAll() {
  const snapshot = plugins.value;
  const today = new Date().toISOString();
  const loc = locale.value;
  const approxLabels = buildApproxLabels();
  const out: RenderedNote[] = [];
  for (const plugin of snapshot) {
    if (!plugin.enabled) continue;
    const src = plugin.origin.source;
    if (!src) continue;
    try {
      const results = await runPlugin(src, {
        today,
        locale: loc,
        approxLabels,
      });
      setPluginError(plugin.id, undefined);
      for (const result of results) {
        out.push({ pluginId: plugin.id, pluginName: plugin.name, result });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPluginError(plugin.id, message);
      out.push(buildErrorNote(plugin.id, plugin.name, message));
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
 * Wire up the effect that re-invokes plugins. Runs once on mount, then only
 * when plugins change, the locale changes, or `refreshAutoNotes()` is called.
 */
export function initAutoNotes(): () => void {
  if (disposer) return disposer;

  const stopEffect = effect(() => {
    void plugins.value;
    void locale.value;
    void refreshTick.value;
    scheduleRun();
  });

  disposer = () => {
    stopEffect();
    disposer = null;
  };
  return disposer;
}

const DEFAULT_COLOR = "default" as NoteColor;
const DEFAULT_FONT = "default" as NoteFont;

function toNote(rendered: RenderedNote, index: number): Note {
  const { result, pluginId } = rendered;
  const noteKey = result.key ?? "";
  const id = `generated:${pluginId}:${noteKey || index}`;
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
    position: override?.position ?? result.position ?? -1_000_000 - index,
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
