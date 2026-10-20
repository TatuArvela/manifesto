import { useEffect, useRef, useState } from "preact/hooks";

/**
 * A module loaded the first time that `wanted` is true, and then kept. It is
 * for a part of the app that most sessions never open (Settings, the admin
 * view). Thus, its bytes cost nobody anything at startup. Null until it
 * arrives.
 *
 * `load` is a function at module level around one `import()`, which the bundler
 * changes into its own chunk. A fetch that fails (offline, or a tab left open
 * over a deploy whose chunks are gone) calls `onFail`. The code tries again the
 * next time that `wanted` becomes true.
 */
export function useLazyModule<T>(
  load: () => Promise<T>,
  wanted: boolean,
  onFail: () => void,
): T | null {
  const [loaded, setLoaded] = useState<T | null>(null);
  const loading = useRef(false);
  const mounted = useRef(true);
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!wanted || loaded !== null || loading.current) return;
    loading.current = true;
    load().then(
      (module) => {
        loading.current = false;
        // Wrapped, because a component is a function, and `setLoaded` would
        // call it as an updater.
        if (mounted.current) setLoaded(() => module);
      },
      () => {
        loading.current = false;
        if (mounted.current) onFailRef.current();
      },
    );
  }, [load, wanted, loaded]);

  return loaded;
}
