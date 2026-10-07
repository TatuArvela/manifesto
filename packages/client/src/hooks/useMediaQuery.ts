import { useEffect, useState } from "preact/hooks";

/**
 * Whether a media query matches, kept current as the window changes. For the
 * few places where a width decides where something is mounted, not only how it
 * looks, which CSS alone cannot say.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof matchMedia === "function" && matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = matchMedia(query);
    const update = () => setMatches(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return matches;
}
