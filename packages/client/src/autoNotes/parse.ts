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
    return match[1];
  }
  throw new MissingTitleError();
}
