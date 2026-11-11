---
paths:
  - "packages/client/src/extensions/**"
  - "packages/client/src/hooks/useMilkdownEditor.ts"
  - "packages/client/src/components/editor/**"
  - "packages/client/src/realtime/**"
  - "packages/client/src/utils/editorMarkdown.ts"
  - "packages/client/src/utils/remarkRenderer.ts"
  - "packages/client/src/styles/task-list.css"
  - "packages/client/src/styles/text-spans.css"
  - "packages/client/src/utils/inlineImages.ts"
  - "packages/client/src/utils/rawSpanFormatting.ts"
  - "packages/client/src/hooks/useInlineImages.ts"
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
  renders it. `components/editor/makeNoteEditor.ts` lists its presets and plugins. Add a plugin
  there.
- The build (`useMilkdownEditor`) and the report of the editor (`onEditorReady`) are layout
  effects. The grow of an opened note waits for that report. An effect runs only after the next
  paint, and each one moved the start of the grow one frame later (`layout-and-loading.md`).
- The focus of `autoFocus` comes after the first paint (`afterNextPaint`). A focus needs the style
  and the layout of the page. In the task of the click, it made the browser lay out the new sheet
  for the focus and again for the frame.
- The formatting bar comes after the first paint of a new editor (`barHeights` in
  `NoteEditor.tsx`). Until then, its place has the height that the last bar had, on a phone or on
  a wider screen. Thus, a panel that grows out of a card keeps its size when the bar comes. The bar
  is a third of the elements of an open note, and its render and their style moved the start of
  the grow about 6 ms later. The first editor of a session has no height yet, and builds its bar
  at once. The height is on the place itself, not on a child in it: `useHeldHeight` holds the
  place when a child of it goes.
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

- `manifestoInlineMarks`: inline marks. The text color and the text font are marks with one
  attribute, written as `<span data-color>` / `<span data-font>` with a `NoteColor` / `NoteFont`
  value. `pairInlineTags.ts` accepts only a known value. Thus, a different span stays raw HTML.
- `inlineImageView`: the node view of the image. A pointer to an image of the note (`image:N`,
  `utils/inlineImages.ts`) gets its address from the resolver that `NoteEditor` gives. It also gets
  the buttons of the header (`ImageButtons`) through `InlineImageControls`, which `NoteEditor`
  renders with Preact into the frame of the image. This folder cannot import components. The view
  stops the events of the buttons and ignores their mutations. If not, ProseMirror moves the caret
  on each press and draws the node again. `useTextImages` draws the buttons in a microtask, never
  during the call. A view draws inside a change of the editor, and a change can occur inside a
  render of Preact (an effect that has not run yet runs at the start of the next render of its
  component). A `render` there cleared the hook state of that render, and a note with an image in
  the text crashed when it opened.
- `imagePointers`: when an image leaves the note, `NoteEditor` changes the text through the editor
  (`removeImagePointers`), or the raw textarea, before it calls `onRemoveImage`. Never through the
  `content` of the parent: the editor reads that only when it opens, and its next change writes the
  old pointers back. When the list changes, `NoteEditor` makes each image view resolve again,
  because the same pointer can then name a different image.
- The work of `NoteEditor` on images in the text (the resolver, the buttons, the pointers, the
  placement of a header image) is in its hook `components/editor/useTextImages.tsx`. Its top bar
  and chips are in `EditorChrome.tsx`.
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
- The bars over the text (`checklistBar`, `tableBar`, `linkTooltip`) are placed inside
  `.milkdown-editor` from screen rectangles. They convert them with `rectInHost` (`hostRect.ts`),
  never with a plain difference. They place themselves when the editor gets focus, which is during
  the grow of the panel, while it is scaled down. A plain difference put the checklist bar at half
  its height in the note.
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

`.ProseMirror` scrolls horizontally (for a line that cannot break), and only horizontally. Its
`overflow-y` is `hidden`, because with `overflow-x: auto` a `visible` computes to `auto`. Parts of a
checklist row go below the row, and a note that ends with a checklist then had a second vertical
scroller. On iOS, that scroller took the swipe, and the page did not scroll. A scroller clips
everything that is drawn outside it. The drag handle of the checklist is in the gutter to the left of the text. On a
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
- The teardown also makes the view drop each transaction that arrives after its destroy. The
  timer of y-prosemirror for the cursors of the peers checks a flag that its binding never sets.
  Thus, it dispatched into a destroyed editor when a note in collaboration closed.

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
- When the chunk arrives, `lazyEditor.ts` renders one `NoteEditor` in idle time, in an element
  that is not on the page, and takes it down (`warmUp.ts`). The first open of a session ran the
  code of the editor for the first time, and its click took 105 to 180 ms, against 40 to 55 ms
  for the next ones. A warm-up of Milkdown alone left it at 80 to 107 ms, because the components
  around it also ran for the first time in that click. The create of Milkdown itself stays about
  two times slower in the first open than later (24 ms against 10 ms). No warm-up here removed
  that part.
  - All of it occurs in one task. Milkdown builds and Preact renders in microtasks. Thus, no
    input and no paint come between the mount and the unmount, and no `useEffect` of it runs.
  - Each editor closes the drawing pad when it unmounts (`useTextImages`). Thus, the warm-up does
    nothing while a pad is open. A note that opened before the idle time also makes it
    unnecessary (`editorWasBuilt`).
  - Nothing changes its document. Thus, the listener of Milkdown starts no timer.

## Schema version

If you add or remove a node or mark, or change its attributes (a preset, a plugin, anything in
`extensions/`), make `EDITOR_SCHEMA_VERSION` in `@manifesto/shared` higher.

- `/api/v1/yjs` refuses an editor that is older than that of the server. The refused client locks the
  text behind a reload notice.
- An old editor in the room removes the nodes that it does not know from the copies of all
  participants.

No test can see a schema change. Thus, the person who makes the change is responsible.
