import type { Note } from "@manifesto/shared";
import { evernoteImporter } from "./evernote.ts";
import { htmlImporter } from "./html.ts";
import type { Importer } from "./importer.ts";
import { joplinImporter } from "./joplin.ts";
import { simplenoteImporter } from "./simplenote.ts";
import { standardNotesImporter } from "./standardNotes.ts";

export type { Importer } from "./importer.ts";
export { checkImportSize, MAX_IMPORT_BYTES } from "./importer.ts";

/**
 * Each format of other apps that this app reads, other than its own export,
 * Markdown and Google Keep (`importExport.ts`, `keep.ts`). A new format is an
 * `Importer` added here, and nothing else changes.
 */
export const IMPORTERS: readonly Importer[] = [
  evernoteImporter,
  joplinImporter,
  htmlImporter,
  simplenoteImporter,
  standardNotesImporter,
];

/** The importer that takes files with this extension, if there is one. */
export function importerForFile(extension: string): Importer | null {
  return (
    IMPORTERS.find(
      (importer) =>
        importer.fromFile && importer.extensions.includes(extension),
    ) ?? null
  );
}

/** The notes in a parsed JSON document of a different app, or null. */
export async function notesFromForeignJson(
  data: unknown,
): Promise<Note[] | null> {
  for (const importer of IMPORTERS) {
    const notes = await importer.fromJson?.(data);
    if (notes) return notes;
  }
  return null;
}
