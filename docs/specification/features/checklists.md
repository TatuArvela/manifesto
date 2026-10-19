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

## Move Checked Items to the End of a Checklist

With "Move Checked Items to the End of a Checklist" on (Settings, Features; the `checkedItemsLast` preference, off by default),
ticking an item moves it below the items still to do, and unticking one moves it back up, to the end
of the ones still to do. Each list is ordered among its siblings, nested items moving with their
parent, and both groups keep the order they had. The order is written into the Markdown, so it is
the same on every device and for everyone a note is shared with; the preference only decides
whether a tick by this user reorders. On a card the toggle and the move are one write, and in the
editor one step, which a single undo reverts.

## Uncheck All

"Uncheck all" in the note's Checklist menu, shown when the note has a ticked item, unticks every
item at once, for a packing or shopping list used again. A note shared only to view does not offer it.

## Progress

A card whose note has two or more checklist items draws a thin bar under its text, filled by the
share of items ticked, nested ones counted. Its label ("3 of 5 done") is what a screen reader reads.
"Show Checklist Progress Bar" (Settings, Features; the `checklistProgress` preference, on by
default) turns the bar off for every card at once.

## Interaction from the Card View

Checkboxes can be toggled directly from the note card in the grid/list view, without opening the editor. This is essential for quick-use scenarios like shopping lists.

## Interaction with Collaborative Editing

In connected mode, checkbox toggles are broadcast to everyone viewing the note in real time: a toggle is a document edit like any other, so it travels over the Yjs channel rather than as a note write. See [Collaborative Editing](collaborative-editing.md).
