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
- No separate data structure; the markdown content is the single source of truth

## Dates on Items

An item is given a date by writing it in the item's text as `@` and an ISO date:

```markdown
- [ ] Call the plumber @2026-10-02
```

- The token is ordinary text in the Markdown and stays the only record of the date: nothing is stored beside the note, and the item still reads sensibly in any other Markdown tool
- It is drawn as a chip on the card, in the read-only views (a note shared to view, a public link, a share link) and in the editor, where it stays editable text
- A chip is highlighted as overdue when its date is before today, in the user's own time zone, and the item is not ticked
- It has to be a real date (`@2026-02-30` is text), preceded by a space or the start of the item, and not followed by a letter, a digit or a hyphen. Only the first date in an item counts, and a token in a code span is quoted text
- A token outside a checklist item is plain text
- "Sort items by date" in the note's menu, shown when the note has a dated item, reorders each checklist: soonest first, undated items last, items with the same date and undated items keeping the order they had. Items are sorted among their siblings, and nested items move with their parent. A note shared only to view does not offer it

An item's date does not notify: a reminder belongs to the note (see [Non-goals](../non-goals.md)).

## Interaction from the Card View

Checkboxes can be toggled directly from the note card in the grid/list view, without opening the editor. This is essential for quick-use scenarios like shopping lists.

## Interaction with Collaborative Editing

In connected mode, checkbox toggles are broadcast to everyone viewing the note in real time: a toggle is a document edit like any other, so it travels over the Yjs channel rather than as a note write. See [Collaborative Editing](collaborative-editing.md).
