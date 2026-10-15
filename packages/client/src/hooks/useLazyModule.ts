import { useEffect, useRef, useState } from "preact/hooks";

/**
 * A module fetched the first time `wanted` is true, then kept: for a part of
 * the app most sessions never open (Settings, the admin view), so that it
 * costs nobody its bytes at startup. Null until it has arrived.
 *
 * `load` is a module-level function around one `import()`, which the bundler
 * turns into a chunk of its own. A fetch that fails (offline, or a tab left
 * open over a deploy whose chunks are gone) calls `onFail`, and is tried again
 * the next time `wanted` turns true.
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
        // Wrapped, because a component is a function and `setLoaded` would
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
