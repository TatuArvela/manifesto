import type { Note } from "@manifesto/shared";
import { computed } from "@preact/signals";
import { notes } from "./notesStore.js";

/**
 * Note templates. A template is an ordinary note carrying the tag `template`,
 * or a tag under it (`template/meeting`): there is no field for it and
 * nothing the server knows about. The composer offers them to start a new
 * note from, which is a copy made once and not a note that follows its
 * template afterwards, as an auto-note follows its plugin.
 */
export const TEMPLATE_TAG = "template";

export function isTemplateTag(tag: string): boolean {
  return tag === TEMPLATE_TAG || tag.startsWith(`${TEMPLATE_TAG}/`);
}

/** What a template is called where it is offered. */
export function templateName(note: Pick<Note, "title" | "content">): string {
  if (note.title.trim()) return note.title.trim();
  const firstLine = note.content.split("\n").find((line) => line.trim() !== "");
  return (firstLine ?? "").trim().slice(0, 40);
}

/**
 * The user's templates, by name. An archived note counts, since the archive
 * is the obvious place to keep templates off the board; a trashed one does
 * not. Auto-notes are not in `notes`, so a plugin cannot offer one.
 */
export const templates = computed(() =>
  notes.value
    .filter((note) => !note.trashed && note.tags.some(isTemplateTag))
    .sort((a, b) => templateName(a).localeCompare(templateName(b))),
);

/**
 * What a new note takes from a template: its text, its look and its other
 * tags. Not the template tag, or the copy would be a template too; and not
 * images, the reminder or the pin, as Duplicate leaves those behind.
 */
export function fromTemplate(
  template: Note,
): Pick<Note, "title" | "content" | "color" | "font" | "tags"> {
  return {
    title: template.title,
    content: template.content,
    color: template.color,
    font: template.font,
    tags: template.tags.filter((tag) => !isTemplateTag(tag)),
  };
}
