import { normalizeTag } from "@manifesto/shared";

/**
 * Every auto-note plugin source must begin with a `// @title <name>`
 * directive as its first non-empty line. This keeps the plugin name
 * colocated with its code so users can't end up with a mis-labeled plugin
 * after pasting or refetching.
 */

const TITLE_RE = /^\s*\/\/\s*@title\s+(.+?)\s*$/;

export class MissingTitleError extends Error {
  constructor() {
    super("Plugin source must start with a `// @title <name>` comment.");
    this.name = "MissingTitleError";
  }
}

export function extractPluginTitle(source: string): string {
  for (const line of source.split("\n")) {
    if (line.trim() === "") continue;
    const match = line.match(TITLE_RE);
    if (!match) throw new MissingTitleError();
    return match[1] ?? "";
  }
  throw new MissingTitleError();
}

const READS_RE = /^\s*\/\/\s*@reads\s+(.+?)\s*$/;
/** How many tags one plugin may ask to read. */
export const MAX_READ_TAGS = 20;

/**
 * The tags a plugin asks to read notes from: every `// @reads tag, tag`
 * comment in the block of comments its source opens with, normalized as tags
 * are (`normalizeTag`), each once. Declared in the source, like the
 * title, so what a plugin asks for travels with its code and a refetch that
 * asks for more shows as such. Asking is not having: the user allows each tag
 * (`PluginSource.reads`).
 */
export function extractPluginReads(source: string): string[] {
  const tags: string[] = [];
  for (const line of source.split("\n")) {
    if (line.trim() === "") continue;
    // The header ends at the first line that is not a comment.
    if (!line.trim().startsWith("//")) break;
    const match = line.match(READS_RE);
    if (!match) continue;
    for (const raw of (match[1] ?? "").split(",")) {
      const tag = normalizeTag(raw.trim().replace(/^#/, ""));
      if (tag && !tags.includes(tag)) tags.push(tag);
    }
  }
  return tags.slice(0, MAX_READ_TAGS);
}
