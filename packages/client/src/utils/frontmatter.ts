/**
 * YAML frontmatter as Markdown note apps write it (Obsidian, SilverBullet,
 * Nextcloud Notes, Jekyll-style exports). Only the flat subset those apps use
 * is read: `key: value`, `key: [a, b]` and a `key:` followed by `- item`
 * lines. Anything richer is not frontmatter this importer understands, and
 * the block is then left in the body rather than half-read.
 *
 * A note that merely opens with a horizontal rule must survive untouched, so
 * the block only counts when every line between the fences has that shape.
 */

export type FrontmatterValue = string | string[];

export interface Frontmatter {
  data: Record<string, FrontmatterValue>;
  body: string;
}

const KEY_LINE = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/;
const ITEM_LINE = /^\s+-\s+(.*)$/;

function unquote(value: string): string {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

function parseScalar(raw: string): FrontmatterValue {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v
      .slice(1, -1)
      .split(",")
      .map(unquote)
      .filter((item) => item !== "");
  }
  return unquote(v);
}

export function splitFrontmatter(text: string): Frontmatter {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { data: {}, body: text };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return { data: {}, body: text };

  const data: Record<string, FrontmatterValue> = {};
  let listKey: string | null = null;
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const item = ITEM_LINE.exec(line);
    if (item && listKey !== null) {
      const list = data[listKey];
      const value = unquote(item[1]);
      if (Array.isArray(list)) list.push(value);
      else data[listKey] = value === "" ? [] : [value];
      continue;
    }
    const key = KEY_LINE.exec(line);
    if (!key) return { data: {}, body: text };
    const [, name, value] = key;
    if (value === undefined || value.trim() === "") {
      data[name] = [];
      listKey = name;
    } else {
      data[name] = parseScalar(value);
      listKey = null;
    }
  }
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\s*\n/, "");
  return { data, body };
}

/** A value read as a list: `tags: a, b`, `tags: [a, b]` or a `- a` block. */
export function frontmatterList(value: FrontmatterValue | undefined): string[] {
  if (value === undefined) return [];
  const items = Array.isArray(value) ? value : value.split(",");
  return items
    .map((item) => item.trim().replace(/^#/, ""))
    .filter((item) => item !== "");
}

export function frontmatterString(
  value: FrontmatterValue | undefined,
): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function frontmatterBoolean(
  value: FrontmatterValue | undefined,
): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** An ISO string for a frontmatter date, or undefined if it is not one. */
export function frontmatterDate(
  value: FrontmatterValue | undefined,
): string | undefined {
  const text = frontmatterString(value);
  if (!text) return undefined;
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}
