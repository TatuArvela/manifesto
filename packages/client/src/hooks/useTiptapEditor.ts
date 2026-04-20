import { Editor, type EditorOptions } from "@tiptap/core";
import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Preact hook that manages a Tiptap Editor instance lifecycle.
 * Uses @tiptap/core directly (not @tiptap/react) for reliable Preact compatibility.
 */
export function useTiptapEditor(
  options: Partial<EditorOptions>,
  deps: unknown[] = [],
) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const instance = new Editor({
      ...options,
      element: el,
    });

    setEditor(instance);

    return () => {
      instance.destroy();
      setEditor(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { editor, mountRef };
}
