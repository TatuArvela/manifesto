/**
 * HTML as Markdown, for the formats that store notes as HTML (Evernote's
 * ENML, exported HTML pages). Hand-written over the DOM rather than a
 * library: a note's HTML is paragraphs, emphasis, links, lists, checkboxes,
 * headings, quotes and code, and anything else keeps its text.
 *
 * The HTML is parsed with `DOMParser`, which builds an inert document: no
 * script in it runs and no image in it loads, so a hostile file is text here.
 * What comes out is Markdown, rendered later through the sanitizing renderer
 * like every other note.
 */
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = blocks(doc.body).join("\n\n");
  return (
    out
      .replace(/\n{3,}/g, "\n\n")
      // Evernote puts each checkbox in a division of its own; consecutive
      // ones are one list.
      .replace(/^(- \[[ x]\] .*)\n\n(?=- \[[ x]\] )/gm, "$1\n")
      .trim()
  );
}

const BLOCK = new Set([
  "P",
  "DIV",
  "SECTION",
  "ARTICLE",
  "HEADER",
  "FOOTER",
  "MAIN",
  "EN-NOTE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "HR",
]);

const SKIP = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE", "NOSCRIPT"]);

/** Markdown's own characters, escaped where text would read as syntax. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_[\]])/g, "\\$1");
}

function isBlock(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK.has(node.nodeName);
}

/** The block-level Markdown of an element's children, one entry each. */
function blocks(parent: Node): string[] {
  const out: string[] = [];
  let inline = "";
  const flush = () => {
    let text = inline.replace(/[ \t]+\n/g, "\n").trim();
    // A line that starts with an Evernote checkbox is a task.
    text = text.replace(/^(\[[ x]\] )/gm, "- $1");
    if (text) out.push(text);
    inline = "";
  };
  for (const child of Array.from(parent.childNodes)) {
    if (isBlock(child)) {
      flush();
      const block = blockOf(child as Element);
      if (block) out.push(block);
    } else {
      inline += inlineOf(child);
    }
  }
  flush();
  return out;
}

function blockOf(el: Element): string {
  const name = el.nodeName;
  if (/^H[1-6]$/.test(name)) {
    const text = inlineChildren(el).trim();
    return text ? `${"#".repeat(Number(name[1]))} ${text}` : "";
  }
  if (name === "UL" || name === "OL") return listOf(el, 0);
  if (name === "BLOCKQUOTE") {
    return blocks(el)
      .join("\n\n")
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }
  if (name === "PRE") {
    const code = (el.textContent ?? "").replace(/\n$/, "");
    return `\`\`\`\n${code}\n\`\`\``;
  }
  if (name === "HR") return "---";
  if (name === "TABLE") {
    return Array.from(el.querySelectorAll("tr"))
      .map((row) =>
        Array.from(row.children)
          .map((cell) => inlineChildren(cell).trim())
          .join(" | "),
      )
      .filter((row) => row.replace(/[\s|]/g, ""))
      .join("\n");
  }
  // A paragraph or a division; Evernote nests one division per line.
  return blocks(el).join("\n\n");
}

function listOf(list: Element, depth: number): string {
  const ordered = list.nodeName === "OL";
  const lines: string[] = [];
  let n = 1;
  for (const item of Array.from(list.children)) {
    if (item.nodeName !== "LI") continue;
    const indent = "  ".repeat(depth);
    const nested: string[] = [];
    let text = "";
    for (const child of Array.from(item.childNodes)) {
      if (child.nodeName === "UL" || child.nodeName === "OL") {
        nested.push(listOf(child as Element, depth + 1));
      } else if (isBlock(child)) {
        text += ` ${blocks(child).join(" ")}`;
      } else {
        text += inlineOf(child);
      }
    }
    const checkbox = item.querySelector(':scope > input[type="checkbox"]');
    const marker = ordered ? `${n++}.` : "-";
    const box = checkbox
      ? (checkbox as HTMLInputElement).hasAttribute("checked")
        ? "[x] "
        : "[ ] "
      : "";
    lines.push(`${indent}${marker} ${box}${text.trim()}`);
    lines.push(...nested);
  }
  return lines.join("\n");
}

function inlineChildren(el: Node): string {
  return Array.from(el.childNodes).map(inlineOf).join("");
}

function inlineOf(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText((node.textContent ?? "").replace(/\s+/g, " "));
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const name = el.nodeName;
  if (SKIP.has(name)) return "";
  if (isBlock(el)) return `\n\n${blockOf(el)}\n\n`;
  const inner = () => inlineChildren(el);
  switch (name) {
    case "BR":
      return "\n";
    case "B":
    case "STRONG": {
      const text = inner().trim();
      return text ? `**${text}**` : "";
    }
    case "I":
    case "EM": {
      const text = inner().trim();
      return text ? `*${text}*` : "";
    }
    case "S":
    case "DEL":
    case "STRIKE": {
      const text = inner().trim();
      return text ? `~~${text}~~` : "";
    }
    case "CODE":
      return `\`${(el.textContent ?? "").replace(/`/g, "")}\``;
    case "A": {
      const href = el.getAttribute("href") ?? "";
      const text = inner().trim();
      // Only a link a note can open; anything else keeps its words.
      if (!/^(https?:|mailto:)/i.test(href)) return text;
      return text && text !== href ? `[${text}](${href})` : `<${href}>`;
    }
    case "IMG":
      return "";
    case "EN-TODO":
      // Parsed as HTML, `<en-todo/>` cannot close itself, so the item's text
      // arrives inside it.
      return `${el.getAttribute("checked") === "true" ? "[x] " : "[ ] "}${inner()}`;
    case "INPUT":
      return "";
    default:
      return inner();
  }
}
