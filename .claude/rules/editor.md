---
paths:
  - "packages/client/src/extensions/**"
  - "packages/client/src/hooks/useMilkdownEditor.ts"
  - "packages/client/src/components/MilkdownEditor.tsx"
  - "packages/client/src/components/NoteEditor*.tsx"
  - "packages/client/src/components/NoteCardEditor.tsx"
  - "packages/client/src/components/FormattingToolbar.tsx"
  - "packages/client/src/realtime/**"
  - "packages/client/src/utils/editorMarkdown.ts"
  - "packages/client/src/utils/remarkRenderer.ts"
  - "packages/shared/src/note.ts"
  - "packages/server/src/ws/yjs*.ts"
---

# Editor

Markdown editing uses **Milkdown** (`@milkdown/kit`) with the CommonMark + GFM presets, plus the `history`, `clipboard`, and `listener` plugins. The editor instance is wired up in `hooks/useMilkdownEditor.ts` and rendered by `components/MilkdownEditor.tsx`. Undo/redo flows through Milkdown's history plugin (called via `callCommand(undoCommand)` / `redoCommand`); there is no separate undo/redo hook. Custom ProseMirror behavior lives in `packages/client/src/extensions/` (`manifestoInlineMarks` for inline marks, `taskItemDraggable` for drag-and-drop checklist items, whose drag is `taskItemDrag.ts` and whose list helpers are `taskListStructure.ts`; `richFormatting` for what the formatting toolbar reads and applies; `itemDates` for the `@2026-10-02` chip on a checklist item, a decoration over plain text and so no schema change, with `utils/itemDate.ts` the one definition of the token that the editor, `remarkRenderer.ts` and the Markdown sort share). Read-only previews are rendered by `utils/remarkRenderer.ts` (remark → rehype → sanitized HTML via DOMPurify).

`MilkdownEditor` reads markdown via `getMarkdown()` and post-processes it (`normalizeMarkdown` in `utils/editorMarkdown.ts`: `unescapeBrackets`, `collapseListSpread`) to keep round-trips stable with our preview.

The `listener` plugin serializes on a 200ms debounce it gives no way to cancel, and the timer
throws `Context "editorView" not found` if the editor is gone when it fires. `useMilkdownEditor`
takes a `beforeDestroy` callback for exactly this, and `MilkdownEditor` uses it to empty
`markdownUpdated`. The plugin checks that array's length before it serializes, so an empty one
makes the pending timer a no-op. Anything else added to the editor that outlives a frame needs
disarming there too; teardown is the only moment the context is still intact.

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

Adding, removing or changing the attributes of a node or mark (a preset, a plugin, anything in
`extensions/`) means raising `EDITOR_SCHEMA_VERSION` in `@manifesto/shared`. `/api/yjs` refuses an
editor older than the server's, and the refused client locks the text behind a reload notice; an
old editor left in the room drops the nodes it does not know from every participant's copy. No
test can see a schema change, so this one is on whoever makes it.
