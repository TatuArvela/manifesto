import type { Ctx } from "@milkdown/kit/ctx";
import { headingKeymap, listItemKeymap } from "@milkdown/kit/preset/commonmark";

// Where the presets' own key bindings do the wrong thing, and what does the
// right one instead.

/**
 * Rebinds the presets' keys. Called from the editor's `config`, which runs
 * before the presets read their bindings.
 *
 * Both presets bind a Backspace command to Delete as well, so Delete with
 * the caret at the start of a list item or a heading did what Backspace
 * does: it joined the item into the one above, or turned an H2 into an H1,
 * where it should have deleted the next character. Delete is taken off both.
 */
export function configureEditorKeys(ctx: Ctx): void {
  ctx.update(listItemKeymap.key, (keys) => ({
    ...keys,
    LiftFirstListItem: { ...keys.LiftFirstListItem, shortcuts: "Backspace" },
  }));
  ctx.update(headingKeymap.key, (keys) => ({
    ...keys,
    DowngradeHeading: { ...keys.DowngradeHeading, shortcuts: "Backspace" },
  }));
}
