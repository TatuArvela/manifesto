import {
  AlertTriangle,
  Check,
  Plus,
  RefreshCw,
  Slash,
  Trash2,
  Wand2,
  X,
} from "lucide-preact";
import { useState } from "preact/hooks";
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
import { canReorder, reorderNotes, sortedNotes } from "../state/index.js";
import { ReorderableGrid } from "./ReorderableGrid.js";
import { ToggleSwitch } from "./ToggleSwitch.js";

type AddMode = "inline" | "url" | null;

export function AutoNotesView() {
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [pasteSource, setPasteSource] = useState("");
  const [pasteError, setPasteError] = useState("");
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);

  const list = plugins.value;
  const allNotes = sortedNotes.value;
  const reorderable = canReorder.value;

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

  // The controls and the introduction keep to the centred column that list
  // mode puts everything in, as the search and tag filters do, and stay above
  // the plugins however many there are; each plugin's notes still spread
  // across the grid.
  const column = "w-full max-w-xl mx-auto";

  return (
    <div class="mt-4 mb-6 flex flex-col gap-4">
      {addMode === null && (
        <div class={`flex justify-center ${column}`}>
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

      {addMode !== null && (
        <div
          class={`p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600 space-y-2 ${column}`}
        >
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
      {list.length === 0 && addMode === null && (
        <div
          class={`flex flex-col gap-3 text-sm text-neutral-600 dark:text-neutral-300 ${column}`}
        >
          <div class="flex items-center gap-2 text-neutral-900 dark:text-neutral-100">
            <Wand2 class="w-5 h-5 shrink-0 text-blue-600 dark:text-blue-400" />
            <h2 class="text-base font-semibold">
              {t("settings.autoNotes.empty.title")}
            </h2>
          </div>
          <p>{t("settings.autoNotes.empty.intro")}</p>
          <div>
            <p>{t("settings.autoNotes.empty.uses")}</p>
            <ul class="mt-1 list-disc pl-5 space-y-1">
              <li>{t("settings.autoNotes.empty.use.countdown")}</li>
              <li>{t("settings.autoNotes.empty.use.rota")}</li>
              <li>{t("settings.autoNotes.empty.use.recurring")}</li>
            </ul>
          </div>
          <p class="text-neutral-500 dark:text-neutral-400">
            {t("settings.autoNotes.empty.outro")}
          </p>
        </div>
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
              <ReorderableGrid
                notes={pluginNotes}
                reorderable={reorderable}
                onReorder={(ids, from, to) => void reorderNotes(ids, from, to)}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
