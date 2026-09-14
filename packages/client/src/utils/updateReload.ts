/**
 * When an open page should reload itself onto a new version of the app.
 *
 * The service worker takes over the moment a new version installs (`sw.ts`
 * skips waiting and claims its clients), but the page it takes over keeps
 * running the code it loaded with. Precaching has meanwhile swapped the build
 * underneath it, so that page is one lazy chunk away from asking for a file
 * the deploy has deleted. An app installed on a phone is resumed from the
 * background rather than opened, so it could stay on that version for weeks.
 *
 * Reloading is only done where it cannot be seen to lose anything: while the
 * page is hidden, or the moment it comes back, and never with a dialog up (the
 * note editor is one, and its save is debounced) or with the caret in a field.
 * Otherwise the reload waits for the next time either happens.
 */
export function createUpdateReloader({
  hadController,
  isIdle,
  reload,
}: {
  /**
   * Whether a worker controlled the page when it loaded. The first worker to
   * install also claims the page, which is a controller change too, but there
   * is nothing newer to reload onto.
   */
  hadController: boolean;
  /** No dialog open and nothing being typed. */
  isIdle: () => boolean;
  reload: () => void;
}) {
  let controlled = hadController;
  let pending = false;

  const reloadIfIdle = () => {
    if (!pending || !isIdle()) return;
    pending = false;
    reload();
  };

  return {
    /** The worker controlling the page was replaced. */
    controllerChanged() {
      if (!controlled) {
        controlled = true;
        return;
      }
      pending = true;
    },
    /** The page was hidden or shown. Both are moments nobody is mid-task. */
    visibilityChanged() {
      reloadIfIdle();
    },
    /** Whether a new version is waiting for its moment. For tests. */
    get pending() {
      return pending;
    },
  };
}

/** Whether nothing on the page would be lost, or interrupted, by a reload. */
export function pageIsIdle(doc: Document = document): boolean {
  if (doc.querySelector('[aria-modal="true"]')) return false;
  const active = doc.activeElement;
  if (!active) return true;
  if (active instanceof HTMLElement && active.isContentEditable) return false;
  if (active instanceof HTMLTextAreaElement) return false;
  if (active instanceof HTMLSelectElement) return false;
  if (active instanceof HTMLInputElement) {
    // Typed-into fields only; a focused checkbox holds no work.
    return ["checkbox", "radio", "button", "submit", "range", "color"].includes(
      active.type,
    );
  }
  return true;
}
