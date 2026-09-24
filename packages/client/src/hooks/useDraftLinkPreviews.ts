import type { LinkPreview } from "@manifesto/shared";
import { useRef, useState } from "preact/hooks";
import {
  reportPreviewOverflow,
  resolveLinkPreview,
} from "../state/linkPreviews.js";
import { appendStubPreviews } from "../utils/linkPreview.js";

/**
 * The link previews of a note that does not exist yet. The same two steps as
 * `addLinkPreviews` in `state/linkPreviews.ts` takes for a saved note (a plain
 * card at once, filled in when the preview resolves), held in component state
 * instead of written to storage. A preview still loading when the draft is
 * saved is handed over by {@link DraftLinkPreviews.takePending}, for
 * `applyLinkPreviews` to put into the note the draft became.
 */
export interface DraftLinkPreviews {
  previews: LinkPreview[];
  add(urls: string[]): void;
  remove(index: number): void;
  /** Hands over the previews still loading; the draft stops waiting on them. */
  takePending(): Promise<LinkPreview | null>[];
  clear(): void;
}

export function useDraftLinkPreviews(): DraftLinkPreviews {
  const [previews, setPreviewsState] = useState<LinkPreview[]>([]);
  // As of the last change rather than the last render: a paste and a preview
  // arriving can both land before a render, and building the second change
  // from render state throws away the first.
  const latest = useRef<LinkPreview[]>([]);
  const pending = useRef(new Map<string, Promise<LinkPreview | null>>());

  const setPreviews = (next: LinkPreview[]) => {
    latest.current = next;
    setPreviewsState(next);
  };

  return {
    previews,
    add(urls) {
      const { previews, added, overflow } = appendStubPreviews(
        latest.current,
        urls,
      );
      reportPreviewOverflow(overflow);
      if (added.length === 0) return;
      setPreviews(previews);
      const draft = pending.current;
      for (const url of added) {
        const resolving = resolveLinkPreview(url);
        draft.set(url, resolving);
        resolving.then((resolved) => {
          // Not this draft's any more: it was saved or discarded, and the
          // answer went to the note along with the rest.
          if (pending.current.get(url) !== resolving || !resolved) return;
          setPreviews(
            latest.current.map((p) => (p.url === url ? resolved : p)),
          );
        });
      }
    },
    remove(index) {
      setPreviews(latest.current.filter((_, i) => i !== index));
    },
    takePending() {
      const handed = [...pending.current.values()];
      pending.current = new Map();
      return handed;
    },
    clear() {
      setPreviews([]);
    },
  };
}
