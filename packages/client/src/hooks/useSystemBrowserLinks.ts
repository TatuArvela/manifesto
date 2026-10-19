import { useEffect } from "preact/hooks";
import { handOffHref } from "#/state/externalLinks.ts";

/**
 * With "Open Links in Browser" on in the installed app, a link that would
 * open in a new tab (a note's own, a preview card's, any `target="_blank"`)
 * is handed to the system browser instead (`state/externalLinks.ts`). One
 * listener for the whole app, in the capture phase: a card stops a link's
 * click from bubbling so that it does not open the note too, and that must
 * not stop this.
 */
export function useSystemBrowserLinks(): void {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(e.target instanceof Element)) return;
      const link = e.target.closest<HTMLAnchorElement>("a[href]");
      if (link?.target !== "_blank") return;
      const handOff = handOffHref(link.href);
      if (!handOff) return;
      e.preventDefault();
      window.location.assign(handOff);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
}
