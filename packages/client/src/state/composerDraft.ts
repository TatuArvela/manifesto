import {
  dropOffline,
  keepOffline,
  readOffline,
} from "#/storage/offlineNotes.ts";
import {
  imageKeysOf,
  type KeptFields,
  keptFields,
  offlineOwner,
  restoreImageKeys,
} from "./offlineOwner.ts";

/**
 * The new-note composer's draft, kept on the device while it is being
 * written, so a reload, a closed tab or a phone putting the app away does
 * not lose it. The composer saves it as it changes and reads it back when it
 * opens; closing or discarding the note clears it. One draft a device: two
 * tabs writing at once keep whichever wrote last.
 *
 * Sealed in connected mode (`storage/offlineNotes.ts`), and kept only while
 * the account is unlocked; locked, the composer still holds it in memory.
 */

export type ComposerDraft = KeptFields;

/** How long typing has to pause before the draft is written. */
export const DRAFT_SAVE_MS = 300;

const DRAFT_ID = "current";

/** What has been asked to be written and not yet, or null. */
let waiting: ComposerDraft | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Writes and removals in the order they were asked for. A write is sealed
 * first, which takes a moment, so a clear that followed it could otherwise
 * land first and leave the draft behind.
 */
let chain: Promise<unknown> = Promise.resolve();

function inOrder(work: () => Promise<unknown>): Promise<void> {
  const next = chain.then(work, work);
  chain = next;
  return next.then(
    () => {},
    () => {},
  );
}

function write(draft: ComposerDraft): Promise<void> {
  const owner = offlineOwner();
  if (!owner) return Promise.resolve();
  const record = {
    ...draft,
    imageKeys: imageKeysOf(draft.images, draft.linkPreviews),
  };
  return inOrder(() => keepOffline(owner, "draft", DRAFT_ID, record));
}

/** Keeps `draft` once typing pauses. */
export function saveDraft(draft: ComposerDraft): void {
  waiting = draft;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void flushDraft(), DRAFT_SAVE_MS);
}

/** Writes what is waiting now, as a page is put away. */
export function flushDraft(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const draft = waiting;
  waiting = null;
  return draft ? write(draft) : Promise.resolve();
}

/** Keeps `draft` at once: a note moved back into the composer. */
export function replaceDraft(draft: ComposerDraft): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  waiting = null;
  return write(draft);
}

/** Forgets the draft: the note was saved, or discarded. */
export function clearDraft(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  waiting = null;
  const owner = offlineOwner();
  if (!owner) return Promise.resolve();
  return inOrder(() => dropOffline(owner.id, "draft", DRAFT_ID));
}

/** The kept draft, or null when there is none to read. */
export async function loadDraft(): Promise<ComposerDraft | null> {
  const owner = offlineOwner();
  if (!owner) return null;
  // After whatever is still being written.
  await inOrder(async () => {});
  const [record] = await readOffline(owner, "draft");
  if (!record || typeof record.value !== "object" || record.value === null) {
    return null;
  }
  const value = record.value as Record<string, unknown>;
  restoreImageKeys(value.imageKeys);
  const draft = keptFields(value);
  return isEmptyDraft(draft) ? null : draft;
}

/** Whether a draft holds nothing worth keeping. */
export function isEmptyDraft(draft: ComposerDraft): boolean {
  return (
    draft.title.trim() === "" &&
    draft.content.trim() === "" &&
    draft.images.length === 0 &&
    draft.linkPreviews.length === 0 &&
    draft.tags.length === 0
  );
}

// A page being put away may not come back: a phone discards it, a tab is
// closed. Whatever is waiting is written now rather than after the pause.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flushDraft());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDraft();
  });
}
