/**
 * When an open page must reload itself onto a new version of the app.
 *
 * The service worker takes control at the moment when a new version installs
 * (`sw.ts` skips waiting and claims its clients). But the page that it takes
 * continues to run the code with which it loaded. In the meantime, precaching
 * replaced the build under it. Thus, that page is one lazy chunk away from a
 * request for a file that the deploy deleted. An app installed on a phone
 * resumes from the background, and does not open again. Thus, it could stay on
 * that version for weeks.
 *
 * A reload occurs only where it cannot visibly lose anything: while the page is
 * hidden, or at the moment when it comes back. It never occurs with a dialog
 * open (the note editor is one, and its save is debounced) or with the caret in
 * a field. Otherwise, the reload waits for the next time that one of those
 * occurs.
 */
export function createUpdateReloader({
  hadController,
  isIdle,
  reload,
}: {
  /**
   * If a worker controlled the page when it loaded. The first worker that
   * installs also claims the page, which is also a controller change, but there
   * is nothing newer onto which to reload.
   */
  hadController: boolean;
  /** No dialog open, and nothing typed. */
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
    /** The worker that controls the page was replaced. */
    controllerChanged() {
      if (!controlled) {
        controlled = true;
        return;
      }
      pending = true;
    },
    /**
     * The page was hidden or shown. At both moments, nobody is in the middle of
     * a task.
     */
    visibilityChanged() {
      reloadIfIdle();
    },
    /** If a new version waits for its moment. For tests. */
    get pending() {
      return pending;
    },
  };
}

/** If a reload would lose or interrupt nothing on the page. */
export function pageIsIdle(doc: Document = document): boolean {
  if (doc.querySelector('[aria-modal="true"]')) return false;
  const active = doc.activeElement;
  if (!active) return true;
  if (active instanceof HTMLElement && active.isContentEditable) return false;
  if (active instanceof HTMLTextAreaElement) return false;
  if (active instanceof HTMLSelectElement) return false;
  if (active instanceof HTMLInputElement) {
    // Only fields that the user typed into. A focused checkbox has no work.
    return ["checkbox", "radio", "button", "submit", "range", "color"].includes(
      active.type,
    );
  }
  return true;
}
