# Checklists

Checklists are represented as [GFM task lists](https://github.github.com/gfm/#task-list-items-extension-) within the note's markdown `content` field:

```markdown
- [ ] Unchecked item
- [x] Checked item
- [ ] Another unchecked item
```

## Behavior

- Checkboxes render as interactive, tappable/clickable elements
- Toggling a checkbox mutates the markdown string in-place (flipping `[ ]` to `[x]` or vice versa)
- Checklists and freeform markdown coexist naturally in the same note
- No separate data structure — the markdown content is the single source of truth

## Interaction from the Card View

Checkboxes can be toggled directly from the note card in the grid/list view, without opening the editor. This is essential for quick-use scenarios like shopping lists.

## Interaction with Collaborative Editing

In server mode, checkbox toggles are broadcast to other users in real time. See [Collaborative Editing](collaborative-editing.md).
