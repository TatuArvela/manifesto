# Checklists

A checklist is a [GFM task list](https://github.github.com/gfm/#task-list-items-extension-) in the
markdown `content` field of the note:

```markdown
- [ ] Unchecked item
- [x] Checked item
- [ ] Another unchecked item
```

## Behavior

- Checkboxes are interactive. You can tap or click them.
- When you toggle a checkbox, the app changes the markdown string in place. It changes `[ ]` to
  `[x]`, or `[x]` to `[ ]`.
- Checklists and free markdown can be in the same note.
- There is no separate data structure. The markdown content is the only source of truth.

## Dates on Items

To give an item a date, write `@` and an ISO date in the text of the item:

```markdown
- [ ] Call the plumber @2026-10-02
```

- The token is usual text in the Markdown, and it is the only record of the date. The app stores
  nothing in addition to the note. The item is also correct in other Markdown tools.
- The app shows the token as a chip on the card, in the read-only views (a note shared to view, a
  public link, a share link) and in the editor. In the editor, you can still edit it as text.
- A chip shows as overdue when its date is before today, in the time zone of the user, and the item
  is not ticked.
- The date must be a real date (`@2026-02-30` is text). A space or the start of the item must come
  before it. A letter, a digit or a hyphen must not come after it. Only the first date in an item
  counts. A token in a code span is quoted text.
- A token outside a checklist item is plain text.
- "Sort items by date" in the menu of the note shows when the note has an item with a date. It
  changes the order of each checklist:
  - Items with the nearest date come first, and items without a date come last.
  - Items with the same date, and items without a date, keep their previous order.
  - The sort compares an item only with its siblings. Nested items move with their parent.
  - A note shared only to view does not show this command.

The date of an item does not send a notification. A reminder belongs to the note (see
[Non-goals](../non-goals.md)).

## Move Checked Items to the End of a Checklist

To use this function, set "Move Checked Items to the End of a Checklist" to on (Settings, Features;
the `checkedItemsLast` preference, off by default).

- When you tick an item, it moves below the items that are not done.
- When you untick an item, it moves up, to the end of the items that are not done.
- The sort compares an item only with its siblings. Nested items move with their parent. Both groups
  keep their previous order.
- The app writes the order into the Markdown. Thus, the order is the same on all devices, and for
  all persons who have the note. The preference only controls if a tick by this user changes the
  order.
- On a card, the toggle and the move are one write. In the editor, they are one step, and one undo
  reverts them.

## Uncheck All

"Uncheck all" in the Checklist menu of the note shows when the note has a ticked item. It unticks
all items at the same time. Use it for a packing list or a shopping list that you use again. A note
shared only to view does not show this command.

## Progress

When a note has two or more checklist items, its card shows a thin bar under the text. The bar
shows the part of the items that are ticked. Nested items count. A screen reader reads the label of
the bar ("3 of 5 done"). "Show Checklist Progress Bar" (Settings, Features; the `checklistProgress`
preference, on by default) turns the bar off for all cards at the same time.

## Interaction from the Card View

You can toggle checkboxes directly on the note card in the grid view or the list view. You do not
have to open the editor. This is necessary for quick tasks, for example shopping lists.

## Interaction with Collaborative Editing

In connected mode, the app sends each checkbox toggle in real time to all persons who see the note.
A toggle is a usual document edit. Thus, it goes through the Yjs channel, not as a note write. See
[Collaborative Editing](collaborative-editing.md).
