/**
 * All code that brings Milkdown and ProseMirror in, as one chunk, which only
 * `lazyEditor.ts` imports. A static import of either from the board puts the
 * editor back in the entry chunk.
 */
export { NoteCardEditor } from "./NoteCardEditor.tsx";
export { NoteEditor } from "./NoteEditor.tsx";
