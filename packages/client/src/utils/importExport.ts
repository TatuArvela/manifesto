import type { Note, NoteCreate, NoteVersion } from "@manifesto/shared";
import {
  currentNoteFormat,
  EXPORT_MANIFEST_FILE,
  EXPORT_NOTES_FILE,
  EXPORT_VERSIONS_FILE,
  NewerNoteFormatError,
  upgradeNoteWords,
} from "@manifesto/shared";
import {
  type ImportResult,
  isNoteVersion,
  isValidNoteShape,
  markdownFileToNote,
  normalizeImportedNote,
  parseMarkdownToNote,
  parseNoteJson,
} from "./importedNote.ts";
import {
  importerForFile,
  MAX_IMPORT_BYTES,
  notesFromForeignJson,
} from "./importers/index.ts";
import { isKeepNote, keepNoteToNote } from "./importers/keep.ts";
import { isZipFile, readZip, type ZipEntry } from "./zip.ts";

export type { ImportResult } from "./importedNote.ts";

// The import of files: which files can be imported, and the read of each (a
// note, the export of an app, an archive) into notes for the handlers to store.
// `importedNote.ts` makes the notes. `noteDownload.ts` exports one.

const MARKDOWN_EXTS = [".md", ".markdown"];
const JSON_EXTS = [".json"];
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"];

function fileExtension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  return i === -1 ? "" : base.slice(i).toLowerCase();
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    IMAGE_EXTS.includes(fileExtension(file.name))
  );
}

export function isImportableFile(file: File): boolean {
  const ext = fileExtension(file.name);
  if (MARKDOWN_EXTS.includes(ext) || JSON_EXTS.includes(ext)) return true;
  if (file.type === "application/json") return true;
  if (file.type === "text/markdown" || file.type === "text/x-markdown") {
    return true;
  }
  // Takeout: an archive, or the JSON of an unpacked folder with its images.
  if (isZipFile(file) || isImageFile(file)) return true;
  // The export of a different app (`importers/`).
  if (importerForFile(ext)) return true;
  return false;
}

export async function parseImportFile(file: File): Promise<ImportResult> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`File exceeds ${MAX_IMPORT_BYTES} bytes`);
  }
  const text = await file.text();
  const ext = fileExtension(file.name);
  if (MARKDOWN_EXTS.includes(ext) || file.type.startsWith("text/markdown")) {
    return { kind: "single", note: parseMarkdownToNote(text) };
  }
  if (JSON_EXTS.includes(ext) || file.type === "application/json") {
    return parseNoteJson(text);
  }
  throw new Error("Unsupported file type");
}

export interface ImportSummary {
  singleCount: number;
  bulkCount: number;
  failedCount: number;
  /** Archives refused because they come from a newer version of the app. */
  newerCount: number;
}

interface ImportHandlers {
  /** Resolves `null` if the note could not be stored. */
  createNote: (input: Partial<NoteCreate>) => Promise<Note | null>;
  /** Resolves `false` if the merge could not be stored. */
  importBulk: (notes: Note[]) => Promise<boolean>;
  /**
   * The version history of an export, after its notes are stored. Never
   * rejects.
   */
  importVersions?: (versions: NoteVersion[]) => Promise<void>;
}

const textDecoder = new TextDecoder();

function parseJsonOrNull(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

/**
 * Reads an archive into notes: each Markdown file in it, and each Keep note of
 * a Takeout zip, which has the JSON files of Keep for each note next to their
 * attachments. The code ignores all other content (other Google products, the
 * `.html` copies of Keep, the settings of a vault). All entries share the byte
 * budget. Thus, an archive cannot be more than one file would be permitted to
 * be.
 *
 * An export (of either mode; see `exportArchiveFiles`) is the exception. Its
 * `notes.json` contains each note fully (ids, colors, images, the trash), and
 * its Markdown files are the same notes with less data, for other tools. Thus,
 * when it is there, it is the import, with `versions.json` next to it, and the
 * code does not read the remaining archive. Its `manifest.json` tells the
 * format of the notes. The code updates an older format. It refuses an archive
 * with a format newer than this build reads (`NewerNoteFormatError`), and does
 * not read it incorrectly.
 */
async function notesFromZip(
  file: File,
): Promise<{ notes: Note[]; versions: NoteVersion[] }> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`File exceeds ${MAX_IMPORT_BYTES} bytes`);
  }
  const entries = await readZip(file);
  let budget = MAX_IMPORT_BYTES;
  const read = async (entry: ZipEntry) => {
    const bytes = await entry.read(budget);
    budget -= bytes.length;
    return bytes;
  };
  const byDirAndName = new Map<string, ZipEntry>();
  for (const entry of entries) byDirAndName.set(entry.name, entry);

  const exportedNotes = entries.find((e) =>
    /^([^/]+\/)?notes\.json$/.test(e.name),
  );
  if (exportedNotes) {
    const data = parseJsonOrNull(textDecoder.decode(await read(exportedNotes)));
    if (
      Array.isArray(data) &&
      data.length > 0 &&
      !data.some((item) => !isValidNoteShape(item))
    ) {
      const dir = exportedNotes.name.slice(0, -EXPORT_NOTES_FILE.length);
      const format = await archiveFormat(
        byDirAndName.get(dir + EXPORT_MANIFEST_FILE),
        read,
      );
      if (format > currentNoteFormat()) throw new NewerNoteFormatError(format);
      const history = byDirAndName.get(dir + EXPORT_VERSIONS_FILE);
      const versions = history
        ? parseJsonOrNull(textDecoder.decode(await read(history)))
        : null;
      return {
        notes: data.map((item: Record<string, unknown>) =>
          upgradeNoteWords(normalizeImportedNote(item), format),
        ),
        versions: Array.isArray(versions)
          ? versions
              .filter(isNoteVersion)
              .map((version) => upgradeNoteWords(version, format))
          : [],
      };
    }
  }

  // A zipped folder puts each file under the name of that folder. That name is
  // the name of the archive, not a category. Thus, the code does not make it a
  // tag.
  const markdown = entries.filter((e) =>
    MARKDOWN_EXTS.includes(fileExtension(e.name)),
  );
  const firstDir = (name: string) =>
    name.includes("/") ? name.slice(0, name.indexOf("/") + 1) : "";
  const [first] = markdown;
  const root =
    first && markdown.every((e) => firstDir(e.name) === firstDir(first.name))
      ? firstDir(first.name)
      : "";

  const notes: Note[] = [];
  for (const entry of markdown) {
    // Folders that a tool keeps for itself are not notes.
    if (/(^|\/)\.(obsidian|trash|git)\//.test(entry.name)) continue;
    notes.push(
      markdownFileToNote(
        entry.name.slice(root.length),
        textDecoder.decode(await read(entry)),
      ),
    );
  }
  for (const entry of entries) {
    if (fileExtension(entry.name) !== ".json") continue;
    const data = parseJsonOrNull(textDecoder.decode(await read(entry)));
    if (!isKeepNote(data)) {
      // The JSON of a different app. The export of Simplenote zips its notes in
      // this way.
      const foreign = await notesFromForeignJson(data);
      if (foreign) notes.push(...foreign);
      continue;
    }
    const dir = entry.name.slice(0, entry.name.lastIndexOf("/") + 1);
    notes.push(
      await keepNoteToNote(data as Record<string, unknown>, async (path) => {
        const sibling = byDirAndName.get(dir + baseName(path));
        return sibling ? read(sibling) : null;
      }),
    );
  }
  return { notes, versions: [] };
}

/**
 * The format of the notes of an export, from its manifest: 1 for an archive
 * from before formats were recorded, which has none, and for an archive that
 * does not tell.
 */
async function archiveFormat(
  manifest: ZipEntry | undefined,
  read: (entry: ZipEntry) => Promise<Uint8Array>,
): Promise<number> {
  if (!manifest) return 1;
  const data = parseJsonOrNull(textDecoder.decode(await read(manifest)));
  const format =
    typeof data === "object" && data !== null
      ? (data as { format?: unknown }).format
      : undefined;
  return typeof format === "number" && Number.isInteger(format) && format >= 1
    ? format
    : 1;
}

/**
 * Process one or more files. Each file becomes a new single note (Markdown or
 * single-note JSON) or a bulk merge (JSON array, archive). Keep notes selected
 * from an unpacked Takeout folder are collected into one merge, with the images
 * selected with them as their attachments.
 */
export async function importFiles(
  files: Iterable<File>,
  handlers: ImportHandlers,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    singleCount: 0,
    bulkCount: 0,
    failedCount: 0,
    newerCount: 0,
  };
  const all = [...files];
  const images = new Map<string, File>();
  for (const file of all) {
    if (isImageFile(file)) images.set(baseName(file.name), file);
  }
  const keepNotes: Note[] = [];
  let usedImages = false;

  const bulk = async (notes: Note[]): Promise<boolean> => {
    if (notes.length > 0 && (await handlers.importBulk(notes))) {
      summary.bulkCount += notes.length;
      return true;
    }
    summary.failedCount++;
    return false;
  };

  for (const file of all) {
    if (isImageFile(file)) continue;
    if (!isImportableFile(file)) {
      summary.failedCount++;
      continue;
    }
    try {
      if (isZipFile(file)) {
        const archive = await notesFromZip(file);
        if ((await bulk(archive.notes)) && archive.versions.length > 0) {
          await handlers.importVersions?.(archive.versions);
        }
        continue;
      }
      const foreign = importerForFile(fileExtension(file.name));
      if (foreign?.fromFile) {
        const notes = await foreign.fromFile(file);
        if (notes) await bulk(notes);
        else summary.failedCount++;
        continue;
      }
      if (
        fileExtension(file.name) === ".json" &&
        file.size <= MAX_IMPORT_BYTES
      ) {
        const data = parseJsonOrNull(await file.text());
        const foreignNotes = await notesFromForeignJson(data);
        if (foreignNotes) {
          await bulk(foreignNotes);
          continue;
        }
        if (isKeepNote(data)) {
          keepNotes.push(
            await keepNoteToNote(
              data as Record<string, unknown>,
              async (path) => {
                const image = images.get(baseName(path));
                if (!image) return null;
                usedImages = true;
                return new Uint8Array(await image.arrayBuffer());
              },
            ),
          );
          continue;
        }
      }
      const result = await parseImportFile(file);
      // The handlers report their own failure and resolve. Thus, a rejection
      // here means that the *file* was unreadable. A falsy result means that it
      // parsed and could not be stored. For the user, both are one failed file.
      if (result.kind === "single") {
        if (await handlers.createNote(result.note)) {
          summary.singleCount++;
        } else {
          summary.failedCount++;
        }
      } else {
        await bulk(result.notes);
      }
    } catch (err) {
      summary.failedCount++;
      if (err instanceof NewerNoteFormatError) summary.newerCount++;
    }
  }
  if (keepNotes.length > 0) await bulk(keepNotes);
  // An image is only an attachment. When it is selected with no note to which
  // to attach it, it is one file that did not import.
  if (!usedImages && keepNotes.length === 0) summary.failedCount += images.size;
  return summary;
}
