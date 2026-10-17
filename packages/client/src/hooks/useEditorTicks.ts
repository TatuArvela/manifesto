import type { Editor } from "@milkdown/kit/core";
import { editorViewCtx } from "@milkdown/kit/core";
import type { RefObject } from "preact";
import { useEffect, useState } from "preact/hooks";

/**
 * A count that goes up with every change the toolbar has to look at again:
 * each transaction of the rich editor, and in raw mode the textarea's typing
 * and caret moves. Whatever reads the editor on render is as fresh as the
 * last tick, since the tick is what schedules the render.
 */
export function useEditorTicks(
  editor: Editor | null,
  rawMode: boolean,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): number {
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const prev =
        view.props.dispatchTransaction?.bind(view) ??
        ((tr: Parameters<typeof view.state.apply>[0]) =>
          view.updateState(view.state.apply(tr)));
      view.setProps({
        dispatchTransaction(tr) {
          prev(tr);
          if (!cancelled) setTicks((c) => c + 1);
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [editor]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!rawMode || !textarea) return;
    const bump = () => setTicks((c) => c + 1);
    const onSelectionChange = () => {
      if (document.activeElement === textarea) bump();
    };
    const events = ["input", "select", "keyup", "mouseup", "focus"] as const;
    for (const type of events) textarea.addEventListener(type, bump);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      for (const type of events) textarea.removeEventListener(type, bump);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [rawMode, textareaRef]);

  return ticks;
}
