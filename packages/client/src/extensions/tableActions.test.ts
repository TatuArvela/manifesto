import { Schema } from "@milkdown/kit/prose/model";
import {
  EditorState,
  TextSelection,
  type Transaction,
} from "@milkdown/kit/prose/state";
import { tableNodes } from "@milkdown/kit/prose/tables";
import { describe, expect, it } from "vitest";
import { defined } from "#/test/defined.ts";
import {
  applyTableAction,
  availableTableActions,
  createTable,
  insertTable,
} from "./tableActions.ts";

// The table nodes as `@milkdown/preset-gfm` has them: a header row of its own
// type, then at least one row of plain cells.
const cells = tableNodes({
  tableGroup: "block",
  cellContent: "paragraph",
  cellAttributes: { alignment: { default: "left" } },
});
const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    text: { group: "inline" },
    paragraph: { group: "block", content: "inline*" },
    table: { ...cells.table, content: "table_header_row table_row+" },
    table_header_row: { ...cells.table_row, content: "(table_header)*" },
    table_row: { ...cells.table_row, content: "(table_cell)*" },
    table_header: cells.table_header,
    table_cell: cells.table_cell,
  },
});

/** The table's cells row by row, `H` for a header cell and `c` for the rest. */
function shape(state: EditorState): string[] {
  const rows: string[] = [];
  state.doc.descendants((node) => {
    if (
      node.type.name === "table_header_row" ||
      node.type.name === "table_row"
    ) {
      let row = "";
      node.forEach((cell) => {
        row += cell.type.name === "table_header" ? "H" : "c";
      });
      rows.push(row);
      return false;
    }
    return true;
  });
  return rows;
}

/** A document of one new table, the caret in the cell at `row`, `column`. */
function tableWithCaret(row: number, column: number): EditorState {
  const table = defined(createTable(schema) ?? undefined);
  const doc = schema.node("doc", null, [table]);
  let pos = 1;
  for (let r = 0; r < row; r++) pos += table.child(r).nodeSize;
  pos += 1;
  for (let c = 0; c < column; c++)
    pos += defined(table.child(row).maybeChild(c) ?? undefined).nodeSize;
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, pos + 2),
  });
}

function run(
  state: EditorState,
  action: Parameters<typeof applyTableAction>[1],
) {
  let next: Transaction | null = null;
  applyTableAction(state, action, (tr) => {
    next = tr;
  });
  return next ? state.apply(next) : null;
}

describe("tables from the toolbar", () => {
  it("makes a header row and two rows of three cells", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [schema.node("paragraph")]),
    });
    const tr = defined(insertTable(state) ?? undefined);
    const next = state.apply(tr);
    expect(shape(next)).toEqual(["HHH", "ccc", "ccc"]);
    expect(next.selection.$from.parent.type.name).toBe("paragraph");
    expect(next.selection.$from.node(-1).type.name).toBe("table_header");
  });

  it("adds a plain row under the header row, not a second header row", () => {
    const next = defined(run(tableWithCaret(0, 1), "addRowAfter") ?? undefined);
    expect(shape(next)).toEqual(["HHH", "ccc", "ccc", "ccc"]);
    expect(next.selection.$from.node(-2).type.name).toBe("table_row");
  });

  it("keeps the header row and the last row under it", () => {
    expect(availableTableActions(tableWithCaret(0, 0))).not.toContain(
      "deleteRow",
    );
    const twoRows = tableWithCaret(1, 0);
    expect(availableTableActions(twoRows)).toContain("deleteRow");
    const oneRow = defined(run(twoRows, "deleteRow") ?? undefined);
    expect(shape(oneRow)).toEqual(["HHH", "ccc"]);
    expect(availableTableActions(oneRow)).not.toContain("deleteRow");
  });

  it("removes a column, but not the last one", () => {
    let state = tableWithCaret(1, 0);
    state = defined(run(state, "deleteColumn") ?? undefined);
    state = defined(run(state, "deleteColumn") ?? undefined);
    expect(shape(state)).toEqual(["H", "c", "c"]);
    expect(availableTableActions(state)).not.toContain("deleteColumn");
    expect(availableTableActions(state)).toContain("deleteTable");
  });

  it("offers nothing outside a table", () => {
    const state = EditorState.create({
      doc: schema.node("doc", null, [schema.node("paragraph")]),
    });
    expect(availableTableActions(state)).toEqual([]);
  });
});
