---
paths:
  - "packages/client/src/extensions/**"
  - "packages/client/src/hooks/useMilkdownEditor.ts"
  - "packages/client/src/components/editor/**"
  - "packages/client/src/realtime/**"
  - "packages/client/src/utils/editorMarkdown.ts"
  - "packages/client/src/utils/remarkRenderer.ts"
  - "packages/client/src/styles/task-list.css"
  - "packages/shared/src/note.ts"
  - "packages/server/src/ws/yjs*.ts"
---

# Editor

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark + GFM presets, plus the `history`, `clipboard`, and `listener` plugins and the gap cursor from `plugin/cursor` (only that: its drop indicator would draw over the checklist's own drag). Milkdown loads no styles, so what ProseMirror's own stylesheet requires (`white-space`, the hidden selection, the gap cursor) is copied into `styles/editor.css`. The editor instance is wired up in `hooks/useMilkdownEditor.ts` and rendered by `components/editor/MilkdownEditor.tsx`. Undo/redo goes through `editorHistory(state)` (`extensions/editorHistory.ts`), never Milkdown's `undoCommand` directly: a solo editor has Milkdown's `history` plugin, but a collaborative one has y-prosemirror's `yUndoPlugin` in its place (mixing the two double-applies undo on remote changes), and `yjsCollab` installs it with `editorHistoryPlugins`, which binds the keys and the browser's own undo to it and lets the toolbar find it. Driving Milkdown's history there finds nothing to undo. Custom ProseMirror behavior lives in `packages/client/src/extensions/` (`manifestoInlineMarks` for inline marks, `taskItemDraggable` for drag-and-drop checklist items, whose drag is `taskItemDrag.ts`, where a drop lands is worked out in `taskItemDropTarget.ts` (no DOM, so tested in Node), and whose list helpers are `taskListStructure.ts`; `richFormatting` for what the formatting toolbar reads and applies (its list buttons are `listToggle`, never Milkdown's `wrapIn…ListCommand`, which puts every selected line in one item and never toggles off), with `blockInsertion` putting whole blocks (a divider, a table) in after the caret's top-level block rather than splitting it, and `tableActions` for the table's changes, offered by the bar over the table the caret is in (`tableBar`) and, for the keyboard, by the toolbar's Table menu, which refuses any change that leaves a table Markdown cannot write (no header row, no row under it, no column); `editorKeys` for the keys the presets bind wrongly, rebound in the editor's `config` (which runs before a preset reads its `…Keymap` ctx) or overridden by a keymap of its own, which runs ahead of every preset's since Milkdown puts its own keymaps after `prosePluginsCtx`; `itemDates` for the `@2026-10-02` chip on a checklist item, a decoration over plain text and so no schema change, with `utils/itemDate.ts` the one definition of the token that the editor, `remarkRenderer.ts` and the Markdown sort share, and `setItemDate` the one way the editor writes it, offered by the bar over the checklist item the caret is in (`checklistBar`), whose date button opens the browser's own picker). Read-only previews are rendered by `utils/remarkRenderer.ts` (remark → rehype → sanitized HTML via DOMPurify).

`.ProseMirror` scrolls sideways (a line that cannot break), and a scroller clips whatever is drawn outside it. The checklist's drag handle sits in the gutter left of the text, so on a desktop, where the list keeps no room for it, the text reaches out over the note's padding by the gutter and pads itself back in (`styles/task-list.css`). Take that away and the handle is cut off whole with nothing failing.

`MilkdownEditor` reads markdown via `getMarkdown()` and post-processes it (`normalizeMarkdown` in `utils/editorMarkdown.ts`: `unescapeBrackets`, `collapseListSpread`) to keep round-trips stable with our preview.

The `listener` plugin serializes on a 200ms debounce it gives no way to cancel, and the timer
throws `Context "editorView" not found` if the editor is gone when it fires. `useMilkdownEditor`
takes a `beforeDestroy` callback for exactly this, and `MilkdownEditor` uses it to empty
`markdownUpdated`. The plugin checks that array's length before it serializes, so an empty one
makes the pending timer a no-op. Anything else added to the editor that outlives a frame needs
disarming there too; teardown is the only moment the context is still intact.

A parent that keeps the editor from `onEditorReady` drops it on `onEditorGone`. A destroyed editor
throws `Context "editorState" not found` on every read, and `NoteEditor` reads its editor in render
(`textActions`), so one held across the solo to collab remount threw on the next render.

**Collaborative binding.** Once `collab` is supplied, the shared `Y.XmlFragment` is the authority
and the `content` prop must never be written into a fragment that already holds something: doing
so deletes another session's work on every device at once. Four pieces enforce that, and the
tests in `MilkdownEditor.browser.test.tsx` / `NoteCardEditor.browser.test.tsx` fail if any one is
removed: `NoteCardEditor` withholds `collab` until the provider reports `synced`, `NoteEditor` keys
the editor on `collab` so it rebuilds with the plugin installed, `MilkdownEditor` seeds the
fragment from the note *only* when it is empty, and it holds the editor unbuilt until
`loadYjsCollab()` resolves. Any effect with `editor` in its dep array also runs
at mount, after `ySyncPlugin` has rendered the shared document, so an effect that pushes local
content must first establish that it is reacting to a change and not to the editor's arrival.

The row can still be newer than the document, when something wrote it without the editor (MCP,
the REST API, a restored version). `realtime/contentAgreement.ts` tells that apart from a row that is
merely behind: the document records a hash of each text an editor sends (claimed *before* the send)
and the `updatedAt` of the last save that landed, and `NoteCardEditor` writes an unclaimed, newer row
in from the one client with the lowest awareness id. Every save of the editor's text goes through
its `saveText`, or that text is not claimed and comes back as an outside write over later typing.

The collaboration stack is loaded on demand and that is a correctness constraint, not only a size
one. `realtime/yjsSession.ts` holds every Yjs/Hocuspocus/y-indexeddb import and is reached only
through `import()` in `useNoteYDoc`; `extensions/yjsCollab.ts` fetches `y-prosemirror` through
`loadYjsCollab()`. The fetch must finish *before* `Editor.make()`, never inside the plugin's
runner: Milkdown reads `prosePluginsCtx` to build the view in the same pass, so a runner that
awaits anything before `ctx.update` installs `ySyncPlugin` after the view exists. The editor then
shows the local note instead of the shared document and writes that copy over everyone else's on
the next save. That is why `useMilkdownEditor` takes a `ready` flag. Open mode is the default
build and can never sync, so keeping these three chunks out of the entry is worth ~130 KB
minified to every user who will never use them.

The editor itself is a chunk of its own too: `components/editor/editorChunk.ts` is the only way in to
`NoteEditor` and `NoteCardEditor`, and only `components/editor/lazyEditor.ts` imports it. `App` fetches it
once the board is up. A card or the new-note sheet that is asked to open before it has arrived
waits for it (`useEditor`), because the panel grows out of the card measured with the editor
inside; opening it empty and filling it later morphs to the wrong size. A card this user may only
read opens at once, since `NoteReadonlyView` needs no editor. A static import of anything that
brings Milkdown in, from anywhere the board reaches, puts the whole editor back in the entry chunk
with nothing failing to say so.

Adding, removing or changing the attributes of a node or mark (a preset, a plugin, anything in
`extensions/`) means raising `EDITOR_SCHEMA_VERSION` in `@manifesto/shared`. `/api/yjs` refuses an
editor older than the server's, and the refused client locks the text behind a reload notice; an
old editor left in the room drops the nodes it does not know from every participant's copy. No
test can see a schema change, so this one is on whoever makes it.
