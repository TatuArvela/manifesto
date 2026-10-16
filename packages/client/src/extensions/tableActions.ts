import type { Node as ProseNode, Schema } from "@milkdown/kit/prose/model";
import {
  type EditorState,
  Selection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import {
  addColumnAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  selectedRect,
} from "@milkdown/kit/prose/tables";
import { insertBlock } from "./blockInsertion.js";

// The table menu on the formatting toolbar: making a table, and the row and
// column changes offered while the caret is in one.

export type TableAction =
  | "addRowAfter"
  | "addColumnAfter"
  | "deleteRow"
  | "deleteColumn"
  | "deleteTable";

/**
 * An empty table with a header row, two rows under it and three columns.
 * Markdown has no table without a header row, so the schema has none either.
 */
export function createTable(schema: Schema, rows = 2, columns = 3) {
  const { table, table_header_row, table_header, table_row, table_cell } =
    schema.nodes;
  if (!table || !table_header_row || !table_header || !table_row) return null;
  if (!table_cell) return null;
  const cells = (type: typeof table_cell) =>
    Array.from({ length: columns }, () => type.createAndFill()).filter(
      (cell): cell is ProseNode => cell !== null,
    );
  return table.create(null, [
    table_header_row.create(null, cells(table_header)),
    ...Array.from({ length: rows }, () =>
      table_row.create(null, cells(table_cell)),
    ),
  ]);
}

/** A new table after the caret's block, with the caret in its first cell. */
export function insertTable(state: EditorState): Transaction | null {
  const table = createTable(state.schema);
  return table && insertBlock(state, table, true);
}

/**
 * Which of the actions apply where the selection is, in the order the menu
 * lists them. Removing the header row or the last row under it would leave a
 * table Markdown cannot write down, and removing the only column leaves none,
 * so those are offered as removing the table instead.
 */
export function availableTableActions(state: EditorState): TableAction[] {
  if (!isInTable(state)) return [];
  const rect = selectedRect(state);
  const actions: TableAction[] = ["addRowAfter", "addColumnAfter"];
  const bodyRows = rect.map.height - 1;
  const rowsSelected = rect.bottom - rect.top;
  if (rect.top > 0 && rowsSelected < bodyRows) actions.push("deleteRow");
  if (rect.right - rect.left < rect.map.width) actions.push("deleteColumn");
  actions.push("deleteTable");
  return actions;
}

/**
 * A row of plain cells under the selected ones, aligned as the header is,
 * with the caret in its first cell. Not `addRowAfter` from
 * `prosemirror-tables`, which copies the row above: under the header row
 * that is a second header row, and Markdown has room for one.
 */
function addBodyRowAfter(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
): boolean {
  const { table_row, table_cell } = state.schema.nodes;
  if (!table_row || !table_cell) return false;
  const rect = selectedRect(state);
  const header = rect.table.firstChild;
  if (!header) return false;
  const cells: ProseNode[] = [];
  header.forEach((cell) => {
    const made = table_cell.createAndFill({ alignment: cell.attrs.alignment });
    if (made) cells.push(made);
  });
  let pos = rect.tableStart;
  for (let row = 0; row < rect.bottom; row++) {
    pos += rect.table.child(row).nodeSize;
  }
  const tr = state.tr.insert(pos, table_row.create(null, cells));
  const caret = Selection.findFrom(tr.doc.resolve(pos), 1, true);
  if (caret) tr.setSelection(caret);
  dispatch(tr.scrollIntoView());
  return true;
}

/** Applies `action`, if it is one `availableTableActions` offers. */
export function applyTableAction(
  state: EditorState,
  action: TableAction,
  dispatch: (tr: Transaction) => void,
): boolean {
  if (!availableTableActions(state).includes(action)) return false;
  switch (action) {
    case "addRowAfter":
      return addBodyRowAfter(state, dispatch);
    case "addColumnAfter":
      return addColumnAfter(state, dispatch);
    case "deleteRow":
      return deleteRow(state, dispatch);
    case "deleteColumn":
      return deleteColumn(state, dispatch);
    case "deleteTable":
      return deleteTable(state, dispatch);
  }
}
