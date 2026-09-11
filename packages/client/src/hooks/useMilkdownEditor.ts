import type { Editor } from "@milkdown/kit/core";
import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Preact hook that manages a Milkdown Editor instance lifecycle.
 * The `build` callback is invoked once on mount with the root element
 * and must return an Editor built with Editor.make().config(...).use(...).
 * The hook calls .create() and exposes the editor once ready.
 *
 * `beforeDestroy` runs on a created editor while its context is still intact,
 * which is the only moment a plugin holding a pending timer can be disarmed —
 * see the caller for why that matters.
 */
export function useMilkdownEditor(
  build: (root: HTMLElement) => Editor,
  beforeDestroy?: (editor: Editor) => void,
) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const beforeDestroyRef = useRef(beforeDestroy);
  beforeDestroyRef.current = beforeDestroy;

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const instance = buildRef.current(el);
    let destroyed = false;

    const teardown = () => {
      try {
        beforeDestroyRef.current?.(instance);
      } catch {
        // A teardown hook must not be able to leak the editor by throwing
        // before destroy().
      }
      instance.destroy();
    };

    instance.create().then(
      () => {
        if (destroyed) {
          teardown();
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
      teardown();
      setEditor(null);
    };
  }, []);

  return { editor, mountRef };
}
