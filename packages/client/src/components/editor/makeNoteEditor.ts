import {
  defaultValueCtx,
  Editor,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { gapCursorPlugin } from "@milkdown/kit/plugin/cursor";
import { history } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { checklistBar } from "#/extensions/checklistBar.ts";
import { documentWatcher } from "#/extensions/documentWatcher.ts";
import { configureEditorKeys, editorKeys } from "#/extensions/editorKeys.ts";
import { inlineCalculationsPlugin } from "#/extensions/inlineCalculations.ts";
import {
  type InlineImageControls,
  type InlineImageResolver,
  inlineImageView,
} from "#/extensions/inlineImageView.ts";
import { itemDatesPlugin } from "#/extensions/itemDates.ts";
import { linkTooltip } from "#/extensions/linkTooltip.ts";
import { manifestoInlineMarks } from "#/extensions/manifestoInlineMarks.ts";
import { tableBar } from "#/extensions/tableBar.ts";
import { taskItemDraggable } from "#/extensions/taskItemDraggable.ts";
import { t } from "#/i18n/index.ts";

/** What `makeNoteEditor` builds an editor from. */
export interface NoteEditorParts {
  /** The markdown that the editor shows when it opens. */
  initialContent: string;
  /** Each markdown that the listener reports, as it reports it. */
  onMarkdown: (markdown: string) => void;
  resolveInlineImage: InlineImageResolver;
  inlineImageControls: () => InlineImageControls | undefined;
  /** Each change to the document, also one that the listener skips. */
  documentChanged: () => void;
  /**
   * The collaborative binding. Null for a solo editor, which has the history
   * of Milkdown in its place.
   */
  collab: MilkdownPlugin | null;
}

/** If an editor was made in this session (`warmUp.ts` then does nothing). */
let built = false;

export function editorWasBuilt(): boolean {
  return built;
}

/**
 * The Milkdown editor of a note, with its presets and all of its plugins, in
 * `root`. `MilkdownEditor` calls it one time for each editor that it builds.
 */
export function makeNoteEditor(
  root: HTMLElement,
  parts: NoteEditorParts,
): Editor {
  built = true;
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, parts.initialContent);
      ctx.update(editorViewOptionsCtx, (prev) => ({
        ...prev,
        editable: () => true,
        // The editable area had no name. Thus, a screen reader announced an
        // unnamed text field after the title.
        attributes: {
          role: "textbox",
          "aria-multiline": "true",
          "aria-label": t("editor.contentLabel"),
        },
      }));
      configureEditorKeys(ctx);
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({
        ...prev,
        bullet: "-" as const,
      }));
      ctx.get(listenerCtx).markdownUpdated((_ctx, md) => parts.onMarkdown(md));
    })
    .use(commonmark)
    .use(gfm)
    .use(listener)
    .use(clipboard)
    .use(manifestoInlineMarks)
    .use(inlineImageView(parts.resolveInlineImage, parts.inlineImageControls))
    .use(taskItemDraggable)
    .use(inlineCalculationsPlugin)
    .use(editorKeys)
    .use(gapCursorPlugin)
    .use(itemDatesPlugin)
    .use(linkTooltip)
    .use(tableBar)
    .use(checklistBar)
    .use(documentWatcher(parts.documentChanged));
  editor.use(parts.collab ?? history);
  return editor;
}
