import type { Note } from "@manifesto/shared";

// Saving one note as a file: Markdown for other tools, JSON for this one.

function sanitizeFilename(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[/\\?%*:|"<>]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return cleaned || "note";
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function noteToMarkdown(note: Pick<Note, "title" | "content">): string {
  const title = note.title.trim();
  const body = note.content ?? "";
  const text = title ? `# ${title}\n\n${body}` : body;
  return text.endsWith("\n") ? text : `${text}\n`;
}

export function downloadNoteAsMarkdown(
  note: Pick<Note, "title" | "content">,
): void {
  const filename = `${sanitizeFilename(note.title || "note")}.md`;
  triggerDownload(noteToMarkdown(note), filename, "text/markdown");
}

export function downloadNoteAsJson(note: Note): void {
  const filename = `${sanitizeFilename(note.title || "note")}.json`;
  triggerDownload(JSON.stringify(note, null, 2), filename, "application/json");
}
