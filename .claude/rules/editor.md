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

## Milkdown

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark and GFM presets. It also
uses the `history`, `clipboard` and `listener` plugins, and the gap cursor from `plugin/cursor`.
Only the gap cursor: the drop indicator of that plugin draws over the drag of the checklist.

- Milkdown loads no styles. Thus, `styles/editor.css` contains a copy of the parts that the
  stylesheet of ProseMirror requires (`white-space`, the hidden selection, the gap cursor).
- `hooks/useMilkdownEditor.ts` sets up the editor instance. `components/editor/MilkdownEditor.tsx`
  renders it.
- Read-only previews come from `utils/remarkRenderer.ts` (remark → rehype → HTML that DOMPurify
  sanitizes).

## Undo and redo

Undo and redo go through `editorHistory(state)` (`extensions/editorHistory.ts`). Never use the
`undoCommand` of Milkdown directly.

- A solo editor has the `history` plugin of Milkdown.
- A collaborative editor has the `yUndoPlugin` of y-prosemirror in its place. If you use the two
  together, an undo applies two times on remote changes.
- `yjsCollab` installs `yUndoPlugin` with `editorHistoryPlugins`. That binds the keys and the undo
  of the browser to it, and lets the toolbar find it. In a collaborative editor, the history of
  Milkdown has nothing to undo.

## Extensions

Custom ProseMirror behavior is in `packages/client/src/extensions/`:

- `manifestoInlineMarks`: inline marks.
- `taskItemDraggable`: drag-and-drop of checklist items. The drag is in `taskItemDrag.ts`.
  `taskItemDropTarget.ts` calculates where a drop goes. It has no DOM, so its tests run in Node. The
  list helpers are in `taskListStructure.ts`.
- `richFormatting`: what the formatting toolbar reads and applies.
  - Its list buttons use `listToggle`. Never use the `wrapIn…ListCommand` of Milkdown. That command
    puts all selected lines in one item, and never toggles off.
  - `blockInsertion` puts full blocks (a divider, a table) after the top-level block of the caret.
    It does not split that block.
  - `tableActions` contains the changes to a table. The bar over the table that has the caret
    (`tableBar`) shows them. For the keyboard, the Table menu of the toolbar shows them. It refuses
    each change that makes a table that Markdown cannot write (no header row, no row under it, no
    column).
- `editorKeys`: the keys that the presets bind incorrectly. It binds them again in the `config` of
  the editor (which runs before a preset reads its `…Keymap` ctx), or overrides them with its own
  keymap. That keymap runs before the keymaps of all presets, because Milkdown puts its own keymaps
  after `prosePluginsCtx`.
- `itemDates`: the `@2026-10-02` chip on a checklist item. It is a decoration over plain text, thus
  not a schema change.
  - `utils/itemDate.ts` is the one definition of the token. The editor, `remarkRenderer.ts` and the
    Markdown sort share it.
  - `setItemDate` is the only way that the editor writes it. The bar over the checklist item that
    has the caret (`checklistBar`) shows it. Its date button opens the picker of the browser.

## Layout of the checklist gutter

`.ProseMirror` scrolls horizontally (for a line that cannot break). A scroller clips everything that
is drawn outside it. The drag handle of the checklist is in the gutter to the left of the text. On a
desktop, the list keeps no space for it. Thus, the text extends over the padding of the note by the
width of the gutter, and adds padding back (`styles/task-list.css`). If you remove this, the handle
is fully cut off, and nothing fails.

## Markdown output

`MilkdownEditor` reads markdown through `getMarkdown()`. Then it changes the result
(`normalizeMarkdown` in `utils/editorMarkdown.ts`: `unescapeBrackets`, `collapseListSpread`). This
keeps round trips stable with our preview.

## Teardown

The `listener` plugin serializes after a 200ms debounce, and you cannot cancel it. If the editor is
gone when the timer fires, the timer throws `Context "editorView" not found`.

- `useMilkdownEditor` takes a `beforeDestroy` callback for this problem. `MilkdownEditor` uses it to
  empty `markdownUpdated`.
- The plugin checks the length of that array before it serializes. Thus, an empty array makes the
  waiting timer do nothing.
- If you add other parts to the editor that stay longer than a frame, stop them there too. The
  teardown is the only time when the context is still complete.

A parent that keeps the editor from `onEditorReady` must drop it on `onEditorGone`. A destroyed
editor throws `Context "editorState" not found` on each read. `NoteEditor` reads its editor in the
render (`textActions`). Thus, an editor kept across the remount from solo to collab threw on the next
render.

## Collaborative binding

**Collaborative binding.** When `collab` is supplied, the shared `Y.XmlFragment` is the authority.
Never write the `content` prop into a fragment that already has content. That deletes the work of a
different session on all devices at the same time. Four parts prevent this:

1. `NoteCardEditor` does not give `collab` until the provider reports `synced`.
2. `NoteEditor` uses `collab` as the key of the editor. Thus, the editor builds again with the
   plugin installed.
3. `MilkdownEditor` fills the fragment from the note *only* when the fragment is empty.
4. `MilkdownEditor` does not build the editor until `loadYjsCollab()` resolves.

The tests in `MilkdownEditor.browser.test.tsx` and `NoteCardEditor.browser.test.tsx` fail if you
remove one of them. Each effect with `editor` in its dependency array also runs at mount, after
`ySyncPlugin` rendered the shared document. Thus, an effect that pushes local content must first make
sure that it reacts to a change, not to the arrival of the editor.

The row can still be newer than the document, when a different source wrote it without the editor
(MCP, the REST API, a restored version). `realtime/contentAgreement.ts` tells this from a row that
is only behind:

- The document records a hash of each text that an editor sends (claimed *before* the send).
- It also records the `updatedAt` of the last save that arrived.
- `NoteCardEditor` writes an unclaimed, newer row into the document. Only the client with the lowest
  awareness id does this.

Each save of the text of the editor goes through its `saveText`. If not, that text is not claimed.
It then comes back as an outside write, over text typed later.

## Loading the collaboration stack

The collaboration stack loads on demand. This is a correctness requirement, not only a size
requirement.

- `realtime/yjsSession.ts` contains all Yjs, Hocuspocus and y-indexeddb imports. Only an `import()`
  in `useNoteYDoc` reaches it.
- `extensions/yjsCollab.ts` gets `y-prosemirror` through `loadYjsCollab()`.
- The fetch must be complete *before* `Editor.make()`. Never put it inside the runner of the
  plugin. Milkdown reads `prosePluginsCtx` to build the view in the same pass. Thus, if a runner
  awaits something before `ctx.update`, it installs `ySyncPlugin` after the view exists. The editor
  then shows the local note in place of the shared document. On the next save, it writes that copy
  over the copies of all other persons.
- For this reason, `useMilkdownEditor` takes a `ready` flag.

Open mode is the default build, and it can never sync. When these three chunks are not in the
entry, each user who never uses them downloads approximately 130 KB (minified) less.

## Loading the editor

The editor itself is also a separate chunk. `components/editor/editorChunk.ts` is the only way to
`NoteEditor` and `NoteCardEditor`, and only `components/editor/lazyEditor.ts` imports it.

- `App` gets it after the board shows.
- If a card or the new-note sheet must open before the chunk arrives, it waits (`useEditor`). The
  panel grows out of the card, which the app measures with the editor inside. If the panel opens
  empty and fills later, it changes to the wrong size.
- A card that this user can only read opens immediately, because `NoteReadonlyView` needs no
  editor.
- If code that the board reaches statically imports something that brings in Milkdown, the full
  editor goes back into the entry chunk. Nothing fails to tell you.

## Schema version

If you add or remove a node or mark, or change its attributes (a preset, a plugin, anything in
`extensions/`), make `EDITOR_SCHEMA_VERSION` in `@manifesto/shared` higher.

- `/api/v1/yjs` refuses an editor that is older than that of the server. The refused client locks the
  text behind a reload notice.
- An old editor in the room removes the nodes that it does not know from the copies of all
  participants.

No test can see a schema change. Thus, the person who makes the change is responsible.
