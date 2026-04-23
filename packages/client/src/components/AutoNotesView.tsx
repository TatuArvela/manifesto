import {
  AlertTriangle,
  Check,
  Plus,
  RefreshCw,
  Slash,
  Trash2,
  X,
} from "lucide-preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  addPlugin,
  fetchPluginSource,
  plugins,
  refetchPlugin,
  removePlugin,
  setPluginError,
  togglePlugin,
} from "../autoNotes/registry.js";
import { t } from "../i18n/index.js";
import {
  canReorder,
  noteSize,
  reorderNotes,
  sortedNotes,
  viewMode,
} from "../state/index.js";
import { NoteCard } from "./NoteCard.js";
import { ToggleSwitch } from "./ToggleSwitch.js";

type AddMode = "inline" | "url" | null;

const MASONRY_GAP = 16;

function applyMasonrySpans(container: HTMLElement | null, isSquare: boolean) {
  if (!container) return;
  const children = Array.from(container.children) as HTMLElement[];
  for (const child of children) {
    child.style.gridRowEnd = "span 9999";
  }
  const heights = children.map((child) => {
    if (isSquare) return child.getBoundingClientRect().width;
    return child.getBoundingClientRect().height;
  });
  for (let i = 0; i < children.length; i++) {
    children[i].style.gridRowEnd =
      `span ${Math.ceil(heights[i] + MASONRY_GAP)}`;
  }
}

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

  const rect = children[nearestIdx].getBoundingClientRect();
  return e.clientX < rect.left + rect.width / 2 ? nearestIdx : nearestIdx + 1;
}

export function AutoNotesView() {
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [pasteSource, setPasteSource] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);

  const list = plugins.value;
  const allNotes = sortedNotes.value;
  const isSquare = noteSize.value === "square";
  const isList = viewMode.value === "list";
  const reorderable = canReorder.value;
  const gridRefs = useRef(new Map<string, HTMLDivElement | null>());

  const [dropGap, setDropGap] = useState<number | null>(null);
  const [dropPluginId, setDropPluginId] = useState<string | null>(null);
  const dragSourceId = useRef<string | null>(null);
  const dragPluginId = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (isList) return;
    for (const [, el] of gridRefs.current) {
      applyMasonrySpans(el, isSquare);
    }
  });

  useEffect(() => {
    if (isList) return;
    const containers = [...gridRefs.current.values()].filter(
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
        for (const [, el] of gridRefs.current) {
          applyMasonrySpans(el, isSquare);
        }
      }
    });

    for (const c of containers) observer.observe(c);
    return () => observer.disconnect();
  }, [isList, isSquare]);

  const resetForm = () => {
    setAddMode(null);
    setPasteSource("");
    setPasteError("");
    setUrlValue("");
    setUrlError("");
  };

  const handlePasteSave = () => {
    if (!pasteSource.trim()) return;
    setPasteError("");
    try {
      addPlugin({ kind: "inline", source: pasteSource });
      resetForm();
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleUrlSave = async () => {
    const url = urlValue.trim();
    if (!url) return;
    setUrlBusy(true);
    setUrlError("");
    try {
      const source = await fetchPluginSource(url);
      addPlugin({
        kind: "url",
        url,
        fetchedAt: new Date().toISOString(),
        source,
      });
      resetForm();
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : String(err));
    } finally {
      setUrlBusy(false);
    }
  };

  const handleRefetch = async (id: string) => {
    try {
      await refetchPlugin(id);
      setPluginError(id, undefined);
    } catch (err) {
      setPluginError(id, err instanceof Error ? err.message : String(err));
    }
  };

  const getPluginNotes = (pluginId: string) =>
    allNotes.filter((n) => n.source?.pluginId === pluginId);

  const getSourceIndex = (pluginId: string) =>
    getPluginNotes(pluginId).findIndex((n) => n.id === dragSourceId.current);

  const handleDragStart = (e: DragEvent, id: string, pluginId: string) => {
    if (!reorderable) return;
    dragSourceId.current = id;
    dragPluginId.current = pluginId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
    document.body.classList.add("note-drag-active");
    const target = e.currentTarget as HTMLElement;
    requestAnimationFrame(() => target.classList.add("note-dragging"));
  };

  const handleDragEnd = (e: DragEvent) => {
    const target = e.currentTarget as HTMLElement;
    target.classList.remove("note-dragging");
    document.body.classList.remove("note-drag-active");
    dragSourceId.current = null;
    dragPluginId.current = null;
    setDropGap(null);
    setDropPluginId(null);
  };

  const handleGridDragOver = (e: DragEvent, pluginId: string) => {
    if (!reorderable || dragPluginId.current !== pluginId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const container = gridRefs.current.get(pluginId);
    if (!container) return;

    const gap = findNearestGap(e, container, isList);
    const srcIdx = getSourceIndex(pluginId);
    if (srcIdx !== -1 && (gap === srcIdx || gap === srcIdx + 1)) {
      setDropGap(null);
      setDropPluginId(null);
      return;
    }
    setDropGap(gap);
    setDropPluginId(pluginId);
  };

  const handleGridDragLeave = (e: DragEvent, pluginId: string) => {
    const container = gridRefs.current.get(pluginId);
    if (
      container &&
      e.relatedTarget instanceof Node &&
      container.contains(e.relatedTarget)
    ) {
      return;
    }
    setDropGap(null);
    setDropPluginId(null);
  };

  const handleDrop = (e: DragEvent, pluginId: string) => {
    e.preventDefault();
    const sourceId = dragSourceId.current;
    const gap = dropGap;
    setDropGap(null);
    setDropPluginId(null);
    if (!sourceId || gap === null || dragPluginId.current !== pluginId) return;

    const ids = getPluginNotes(pluginId).map((n) => n.id);
    const fromIndex = ids.indexOf(sourceId);
    if (fromIndex === -1) return;
    const toIndex = gap > fromIndex ? gap - 1 : gap;
    if (toIndex !== fromIndex) {
      void reorderNotes(ids, fromIndex, toIndex);
    }
  };

  const getDropSide = (idx: number, pluginId: string, total: number) => {
    if (dropPluginId !== pluginId || dropGap === null) return undefined;
    if (dropGap === total && idx === total - 1) return "after";
    if (dropGap === idx) return "before";
    return undefined;
  };

  const gridClass = isList
    ? "flex flex-col gap-3"
    : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6 gap-x-4 items-start";
  const gridStyle = isList ? undefined : { gridAutoRows: "1px" };

  return (
    <div class="mt-4 mb-6 flex flex-col gap-4">
      {addMode === null && (
        <div class="flex justify-end">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-neutral-100 dark:bg-neutral-700 rounded-lg font-medium hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
            onClick={() => setAddMode("inline")}
          >
            <Plus class="w-4 h-4" />
            {t("settings.autoNotes.add")}
          </button>
        </div>
      )}

      {list.length === 0 && addMode === null && (
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          {t("settings.autoNotes.empty")}
        </p>
      )}

      {list.map((plugin) => {
        const pluginNotes = allNotes.filter(
          (n) => n.source?.pluginId === plugin.id,
        );
        return (
          <section key={plugin.id} class="flex flex-col gap-3">
            <div class="px-3 py-2 bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-700 rounded-lg flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <span
                  class={`flex-1 min-w-0 text-sm font-medium truncate ${
                    plugin.name
                      ? ""
                      : "italic text-neutral-400 dark:text-neutral-500 font-normal"
                  }`}
                >
                  {plugin.name || t("settings.autoNotes.untitled")}
                </span>
                <span class="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {plugin.origin.kind === "url"
                    ? t("settings.autoNotes.origin.url")
                    : t("settings.autoNotes.origin.inline")}
                </span>
                <ToggleSwitch
                  checked={plugin.enabled}
                  onChange={() => togglePlugin(plugin.id)}
                  iconOff={<Slash class="w-4 h-4" />}
                  iconOn={<Check class="w-4 h-4" />}
                  labelOff={t("settings.autoNotes.disabled")}
                  labelOn={t("settings.autoNotes.enabled")}
                />
                {plugin.origin.kind === "url" && (
                  <button
                    type="button"
                    class="p-1 rounded text-neutral-600 dark:text-neutral-300 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
                    onClick={() => handleRefetch(plugin.id)}
                    aria-label={t("settings.autoNotes.refetch")}
                    title={t("settings.autoNotes.refetch")}
                  >
                    <RefreshCw class="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  class="p-1 rounded text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
                  onClick={() => removePlugin(plugin.id)}
                  aria-label={t("settings.autoNotes.remove")}
                  title={t("settings.autoNotes.remove")}
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>

              {plugin.origin.kind === "url" && (
                <p
                  class="text-[11px] text-neutral-500 dark:text-neutral-400 truncate"
                  title={plugin.origin.url}
                >
                  {plugin.origin.url}
                </p>
              )}

              {plugin.lastError && (
                <p class="text-[11px] text-red-600 dark:text-red-400 flex items-start gap-1">
                  <AlertTriangle class="w-3 h-3 mt-0.5 shrink-0" />
                  <span class="break-all">{plugin.lastError}</span>
                </p>
              )}
            </div>

            {pluginNotes.length > 0 && (
              // biome-ignore lint/a11y/useSemanticElements: grid layout requires div
              <div
                ref={(el) => {
                  gridRefs.current.set(plugin.id, el);
                }}
                role="list"
                class={gridClass}
                style={gridStyle}
                onDragOver={(e) => handleGridDragOver(e, plugin.id)}
                onDragLeave={(e) => handleGridDragLeave(e, plugin.id)}
                onDrop={(e) => handleDrop(e, plugin.id)}
              >
                {pluginNotes.map((note, idx) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    draggable={reorderable}
                    onDragStart={(e) => handleDragStart(e, note.id, plugin.id)}
                    onDragEnd={handleDragEnd}
                    dropSide={getDropSide(idx, plugin.id, pluginNotes.length)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {addMode !== null && (
        <div class="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600 space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex gap-1 text-xs">
              <button
                type="button"
                class={`px-2 py-1 rounded cursor-pointer ${
                  addMode === "inline"
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                    : "hover:bg-neutral-200 dark:hover:bg-neutral-600"
                }`}
                onClick={() => setAddMode("inline")}
              >
                {t("settings.autoNotes.add.paste")}
              </button>
              <button
                type="button"
                class={`px-2 py-1 rounded cursor-pointer ${
                  addMode === "url"
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                    : "hover:bg-neutral-200 dark:hover:bg-neutral-600"
                }`}
                onClick={() => setAddMode("url")}
              >
                {t("settings.autoNotes.add.url")}
              </button>
            </div>
            <button
              type="button"
              class="p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
              onClick={resetForm}
              aria-label={t("settings.data.cancel")}
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          {addMode === "inline" ? (
            <>
              <textarea
                class="w-full px-2 py-1.5 text-xs font-mono bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded min-h-[8rem]"
                placeholder={t("settings.autoNotes.sourcePlaceholder")}
                value={pasteSource}
                onInput={(e) =>
                  setPasteSource((e.target as HTMLTextAreaElement).value)
                }
              />
              {pasteError && (
                <p class="text-xs text-red-600 dark:text-red-400">
                  {pasteError}
                </p>
              )}
              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  class="px-3 py-1 text-sm rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
                  onClick={resetForm}
                >
                  {t("settings.data.cancel")}
                </button>
                <button
                  type="button"
                  class="px-3 py-1 text-sm bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  disabled={!pasteSource.trim()}
                  onClick={handlePasteSave}
                >
                  {t("settings.autoNotes.save")}
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                type="url"
                class="w-full px-2 py-1.5 text-sm bg-white dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded"
                placeholder="https://..."
                value={urlValue}
                onInput={(e) =>
                  setUrlValue((e.target as HTMLInputElement).value)
                }
              />
              {urlError && (
                <p class="text-xs text-red-600 dark:text-red-400">{urlError}</p>
              )}
              <div class="flex justify-end gap-2">
                <button
                  type="button"
                  class="px-3 py-1 text-sm rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
                  onClick={resetForm}
                >
                  {t("settings.data.cancel")}
                </button>
                <button
                  type="button"
                  class="px-3 py-1 text-sm bg-blue-600 text-white rounded font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  disabled={!urlValue.trim() || urlBusy}
                  onClick={handleUrlSave}
                >
                  {urlBusy
                    ? t("settings.autoNotes.fetching")
                    : t("settings.autoNotes.save")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
