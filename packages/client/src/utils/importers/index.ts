import type { Note } from "@manifesto/shared";
import { evernoteImporter } from "./evernote.js";
import { htmlImporter } from "./html.js";
import type { Importer } from "./importer.js";
import { joplinImporter } from "./joplin.js";
import { simplenoteImporter } from "./simplenote.js";
import { standardNotesImporter } from "./standardNotes.js";

export type { Importer } from "./importer.js";
export { checkImportSize, MAX_IMPORT_BYTES } from "./importer.js";

/**
 * Every other app's format this one reads, beside its own export, Markdown
 * and Google Keep (`importExport.ts`, `keepImport.ts`). A new format is an
 * `Importer` added here, and nothing else changes.
 */
export const IMPORTERS: readonly Importer[] = [
  evernoteImporter,
  joplinImporter,
  htmlImporter,
  simplenoteImporter,
  standardNotesImporter,
];

/** The importer that takes files with this extension, if any. */
export function importerForFile(extension: string): Importer | null {
  return (
    IMPORTERS.find(
      (importer) =>
        importer.fromFile && importer.extensions.includes(extension),
    ) ?? null
  );
}

/** The notes in a parsed JSON document of another app's, or null. */
export async function notesFromForeignJson(
  data: unknown,
): Promise<Note[] | null> {
  for (const importer of IMPORTERS) {
    const notes = await importer.fromJson?.(data);
    if (notes) return notes;
  }
  return null;
}
