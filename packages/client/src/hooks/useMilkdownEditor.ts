import type { Editor } from "@milkdown/kit/core";
import { useEffect, useRef, useState } from "preact/hooks";

/**
 * A Preact hook that manages the lifecycle of a Milkdown Editor instance. The
 * hook calls the `build` callback one time on mount with the root element. It
 * must return an Editor built with Editor.make().config(...).use(...). The hook
 * calls .create(), and exposes the editor when it is ready.
 *
 * `beforeDestroy` runs on a created editor while its context is still complete.
 * That is the only time when a plugin that has a waiting timer can be disarmed.
 * See the caller for why that is important.
 *
 * `ready` is true by default. Give false while `build` still needs something
 * (for example, a plugin that loads lazily). Then the editor is created on the
 * render that changes it, and is not built without it.
 */
export function useMilkdownEditor(
  build: (root: HTMLElement) => Editor,
  beforeDestroy?: (editor: Editor) => void,
  ready = true,
) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const buildRef = useRef(build);
  buildRef.current = build;
  const beforeDestroyRef = useRef(beforeDestroy);
  beforeDestroyRef.current = beforeDestroy;

  useEffect(() => {
    const el = mountRef.current;
    if (!el || !ready) return;

    const instance = buildRef.current(el);
    let destroyed = false;

    const teardown = () => {
      try {
        beforeDestroyRef.current?.(instance);
      } catch {
        // A teardown hook must not be able to leak the editor when it throws
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
        // Ignore the error. destroy() on an editor that was not created yet
        // does nothing. Thus, failures here only mean that we never expose a
        // broken editor.
      },
    );

    return () => {
      destroyed = true;
      teardown();
      setEditor(null);
    };
  }, [ready]);

  return { editor, mountRef };
}
