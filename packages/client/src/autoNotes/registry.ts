import { effect, signal } from "@preact/signals";
import { ulid } from "ulid";
import { extractPluginReads, extractPluginTitle } from "./parse.ts";
import type { PluginOrigin, PluginSource } from "./types.ts";

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

function isValidPlugin(value: unknown): value is PluginSource {
  if (!value || typeof value !== "object") return false;
  const plugin = value as Record<string, unknown>;
  if (typeof plugin.id !== "string" || typeof plugin.name !== "string") {
    return false;
  }
  if (typeof plugin.enabled !== "boolean") return false;
  if (
    plugin.reads !== undefined &&
    !(
      Array.isArray(plugin.reads) &&
      plugin.reads.every((t) => typeof t === "string")
    )
  ) {
    return false;
  }
  const origin = plugin.origin as Record<string, unknown> | undefined;
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

// Save on each change.
effect(() => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins.value));
  } catch {
    // Ignore quota or access failures. The plugins still work for this session.
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

/** The tags that the user lets a plugin read. None removes the access. */
export function setPluginReads(id: string, tags: string[]) {
  plugins.value = plugins.value.map((p) =>
    p.id === id ? withReads(p, tags) : p,
  );
}

function withReads(plugin: PluginSource, tags: string[]): PluginSource {
  const { reads: _old, ...rest } = plugin;
  return tags.length > 0 ? { ...rest, reads: [...tags] } : rest;
}

/**
 * What a plugin reads now: the tags that its source asks for and that the user
 * permitted. If a refetched plugin asks for more, it reads no more until the
 * user permits the new tags. If it asks for less, it reads less immediately.
 */
export function grantedReads(plugin: PluginSource): string[] {
  const allowed = plugin.reads ?? [];
  if (allowed.length === 0) return [];
  return declaredReads(plugin).filter((tag) => allowed.includes(tag));
}

/**
 * What each source asks to read. A card asks at each render, and a source can
 * be a quarter of a megabyte to split into lines.
 */
const declaredBySource = new Map<string, string[]>();
const DECLARED_CACHE_SIZE = 50;

/** What the source of a plugin asks to read. */
export function declaredReads(plugin: PluginSource): string[] {
  const { source } = plugin.origin;
  const known = declaredBySource.get(source);
  if (known) return known;
  const declared = extractPluginReads(source);
  declaredBySource.set(source, declared);
  if (declaredBySource.size > DECLARED_CACHE_SIZE) {
    declaredBySource.delete(declaredBySource.keys().next().value as string);
  }
  return declared;
}

export function setPluginError(id: string, error: string | undefined) {
  // Do nothing when nothing changed. If not, a loop of runs starts: each
  // successful plugin clears lastError, which changes the plugins array, which
  // fires again the effect that subscribes to plugins.value, which runs the
  // plugins again…
  const current = plugins.value;
  const target = current.find((p) => p.id === id);
  if (!target) return;
  if (target.lastError === error) return;
  plugins.value = current.map((p) =>
    p.id === id ? { ...p, lastError: error } : p,
  );
}

// Limits remote code that nobody audited. Thus, a compromised plugin host
// cannot send a payload of many megabytes, which the sandbox would evaluate on
// the next refetch.
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
  if (plugin?.origin.kind !== "url") return;
  const source = await fetchPluginText(plugin.origin.url);
  const name = extractPluginTitle(source);
  // A permission ends when the request ends. If a later source names a tag that
  // the new source does not name, the plugin must ask for it again.
  const asked = extractPluginReads(source);
  plugins.value = plugins.value.map((p) =>
    p.id === id && p.origin.kind === "url"
      ? {
          ...withReads(
            p,
            (p.reads ?? []).filter((tag) => asked.includes(tag)),
          ),
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
