import { effect, signal } from "@preact/signals";
import { ulid } from "ulid";
import { extractPluginTitle } from "./parse.js";
import type { PluginOrigin, PluginSource } from "./types.js";

const STORAGE_KEY = "manifesto:auto-notes";

function loadPlugins(): PluginSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPlugin);
  } catch {
    return [];
  }
}

function isValidPlugin(p: unknown): p is PluginSource {
  if (!p || typeof p !== "object") return false;
  const obj = p as Record<string, unknown>;
  if (typeof obj.id !== "string" || typeof obj.name !== "string") return false;
  if (typeof obj.enabled !== "boolean") return false;
  const origin = obj.origin as Record<string, unknown> | undefined;
  if (!origin || typeof origin !== "object") return false;
  if (origin.kind === "inline") return typeof origin.source === "string";
  if (origin.kind === "url") {
    return (
      typeof origin.url === "string" &&
      typeof origin.fetchedAt === "string" &&
      typeof origin.source === "string"
    );
  }
  return false;
}

export const plugins = signal<PluginSource[]>(loadPlugins());

// Persist on change.
effect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins.value));
  } catch {
    // Ignore quota or access failures — plugins will still work for this session.
  }
});

export function addPlugin(origin: PluginOrigin): PluginSource {
  const name = extractPluginTitle(origin.source);
  const plugin: PluginSource = {
    id: ulid(),
    name,
    enabled: true,
    origin,
  };
  plugins.value = [...plugins.value, plugin];
  return plugin;
}

export function removePlugin(id: string) {
  plugins.value = plugins.value.filter((p) => p.id !== id);
}

export function togglePlugin(id: string) {
  plugins.value = plugins.value.map((p) =>
    p.id === id ? { ...p, enabled: !p.enabled } : p,
  );
}

export function setPluginError(id: string, error: string | undefined) {
  // No-op when unchanged, otherwise a rerun loop: every successful plugin
  // clears lastError, which mutates the plugins array, which re-fires the
  // effect that subscribes to plugins.value, which reruns the plugins…
  const current = plugins.value;
  const target = current.find((p) => p.id === id);
  if (!target) return;
  if (target.lastError === error) return;
  plugins.value = current.map((p) =>
    p.id === id ? { ...p, lastError: error } : p,
  );
}

// Caps unaudited remote code so a compromised plugin host can't ship a
// multi-megabyte payload that gets eval'd inside the sandbox on next refetch.
const MAX_PLUGIN_SOURCE_BYTES = 256 * 1024;

async function fetchPluginText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > MAX_PLUGIN_SOURCE_BYTES) {
    throw new Error(`Plugin source exceeds ${MAX_PLUGIN_SOURCE_BYTES} bytes`);
  }
  const source = await res.text();
  if (source.length > MAX_PLUGIN_SOURCE_BYTES) {
    throw new Error(`Plugin source exceeds ${MAX_PLUGIN_SOURCE_BYTES} bytes`);
  }
  return source;
}

export async function refetchPlugin(id: string): Promise<void> {
  const plugin = plugins.value.find((p) => p.id === id);
  if (!plugin || plugin.origin.kind !== "url") return;
  const source = await fetchPluginText(plugin.origin.url);
  const name = extractPluginTitle(source);
  plugins.value = plugins.value.map((p) =>
    p.id === id && p.origin.kind === "url"
      ? {
          ...p,
          name,
          origin: {
            ...p.origin,
            source,
            fetchedAt: new Date().toISOString(),
          },
        }
      : p,
  );
}

export async function fetchPluginSource(url: string): Promise<string> {
  return fetchPluginText(url);
}
