import type { Editor } from "@milkdown/kit/core";
import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Preact hook that manages a Milkdown Editor instance lifecycle.
 * The `build` callback is invoked once on mount with the root element
 * and must return an Editor built with Editor.make().config(...).use(...).
 * The hook calls .create() and exposes the editor once ready.
 */
export function useMilkdownEditor(build: (root: HTMLElement) => Editor) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const instance = buildRef.current(el);
    let destroyed = false;

    instance.create().then(
      () => {
        if (destroyed) {
          instance.destroy();
          return;
        }
        setEditor(instance);
      },
      () => {
        // swallow: destroy() on a not-yet-created editor is a noop,
        // so failures here just mean we never expose a broken editor.
      },
    );

    return () => {
      destroyed = true;
      instance.destroy();
      setEditor(null);
    };
  }, []);

  return { editor, mountRef };
}
