import type { Note, NoteCreate, NoteVersion } from "@manifesto/shared";
import { EXPORT_NOTES_FILE, EXPORT_VERSIONS_FILE } from "@manifesto/shared";
import {
  type ImportResult,
  isNoteVersion,
  isValidNoteShape,
  markdownFileToNote,
  normalizeImportedNote,
  parseMarkdownToNote,
  parseNoteJson,
} from "./importedNote.js";
import {
  importerForFile,
  MAX_IMPORT_BYTES,
  notesFromForeignJson,
} from "./importers/index.js";
import { isKeepNote, keepNoteToNote } from "./importers/keep.js";
import { isZipFile, readZip, type ZipEntry } from "./zip.js";

export type { ImportResult } from "./importedNote.js";

// Importing files: which files can be, and reading each (a note, an app's
// export, an archive) into notes for the handlers to store. What the notes are
// made from is `importedNote.ts`; exporting one is `noteDownload.ts`.

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
  // Takeout: an archive, or an unpacked folder's JSON with its images.
  if (isZipFile(file) || isImageFile(file)) return true;
  // Another app's export (`importers/`).
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
}

interface ImportHandlers {
  /** Resolves `null` if the note could not be stored. */
  createNote: (input: Partial<NoteCreate>) => Promise<Note | null>;
  /** Resolves `false` if the merge could not be stored. */
  importBulk: (notes: Note[]) => Promise<boolean>;
  /** An export's version history, once its notes are stored. Never rejects. */
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
 * Reads an archive into notes: every Markdown file in it, and every Keep note
 * of a Takeout zip, which holds Keep's per-note JSON files beside their
 * attachments. Everything else (other Google products, Keep's `.html` twins,
 * a vault's settings) is ignored. The byte budget is shared by every entry,
 * so an archive cannot add up to more than one file would be allowed.
 *
 * An export (either mode's; see `exportArchiveFiles`) is the exception: its
 * `notes.json` holds every note whole (ids, colors, images, the trash) and its
 * Markdown files are the same notes stripped down for other tools, so when it
 * is there it is the import, with `versions.json` beside it, and the rest of
 * the archive is not read.
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
      const history = byDirAndName.get(dir + EXPORT_VERSIONS_FILE);
      const versions = history
        ? parseJsonOrNull(textDecoder.decode(await read(history)))
        : null;
      return {
        notes: data.map((item: Record<string, unknown>) =>
          normalizeImportedNote(item),
        ),
        versions: Array.isArray(versions) ? versions.filter(isNoteVersion) : [],
      };
    }
  }

  // A zipped folder puts every file under that folder's name; it names the
  // archive, not a category, so it is not made a tag.
  const markdown = entries.filter((e) =>
    MARKDOWN_EXTS.includes(fileExtension(e.name)),
  );
  const firstDir = (name: string) =>
    name.includes("/") ? name.slice(0, name.indexOf("/") + 1) : "";
  const root =
    markdown.length > 0 &&
    markdown.every((e) => firstDir(e.name) === firstDir(markdown[0].name))
      ? firstDir(markdown[0].name)
      : "";

  const notes: Note[] = [];
  for (const entry of markdown) {
    // Folders a tool keeps for itself are not notes.
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
      // Another app's JSON: Simplenote's export zips its notes this way.
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
 * Process one or more files: each file becomes either a new single note
 * (markdown / single-note JSON) or a bulk merge (JSON array, archive). Keep
 * notes picked from an unpacked Takeout folder are gathered into one merge,
 * with the images picked alongside them as their attachments.
 */
export async function importFiles(
  files: Iterable<File>,
  handlers: ImportHandlers,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    singleCount: 0,
    bulkCount: 0,
    failedCount: 0,
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
      // The handlers report their own failure and resolve, so a rejection here
      // means the *file* was unreadable; a falsy result means it parsed and
      // could not be stored. Both are one failed file to the user.
      if (result.kind === "single") {
        if (await handlers.createNote(result.note)) {
          summary.singleCount++;
        } else {
          summary.failedCount++;
        }
      } else {
        await bulk(result.notes);
      }
    } catch {
      summary.failedCount++;
    }
  }
  if (keepNotes.length > 0) await bulk(keepNotes);
  // An image is only ever an attachment; picked with no note to attach it
  // to, it is one file that did not import.
  if (!usedImages && keepNotes.length === 0) summary.failedCount += images.size;
  return summary;
}
