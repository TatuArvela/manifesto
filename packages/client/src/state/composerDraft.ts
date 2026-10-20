import { upgradeNoteWords } from "@manifesto/shared";
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
 * The draft of the new-note composer, kept on the device while the user writes
 * it. Thus, a reload, a closed tab or a phone that puts the app away does not
 * lose it. The composer saves it when it changes, and reads it back when it
 * opens. A close or discard of the note clears it. One draft for each device.
 * If two tabs write at the same time, the last write stays.
 *
 * Sealed in connected mode (`storage/offlineNotes.ts`), and kept only while the
 * account is unlocked. When locked, the composer still keeps it in memory.
 */

export type ComposerDraft = KeptFields;

/** How long typing must pause before the draft is written. */
export const DRAFT_SAVE_MS = 300;

const DRAFT_ID = "current";

/** What a caller asked to write and that is not written yet, or null. */
let waiting: ComposerDraft | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Writes and removals in the order of the requests. A write is sealed first,
 * which takes a short time. Thus, a clear that followed it could otherwise
 * arrive first, and leave the draft.
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

/** Keeps `draft` after typing pauses. */
export function saveDraft(draft: ComposerDraft): void {
  waiting = draft;
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => void flushDraft(), DRAFT_SAVE_MS);
}

/** Writes what waits now, when a page is put away. */
export function flushDraft(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const draft = waiting;
  waiting = null;
  return draft ? write(draft) : Promise.resolve();
}

/** Keeps `draft` immediately: a note moved back into the composer. */
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
  // After all that is still in a write.
  await inOrder(async () => {});
  const [record] = await readOffline(owner, "draft");
  if (!record || typeof record.value !== "object" || record.value === null) {
    return null;
  }
  const value = record.value as Record<string, unknown>;
  restoreImageKeys(value.imageKeys);
  const draft = upgradeNoteWords(keptFields(value), record.format);
  return isEmptyDraft(draft) ? null : draft;
}

/** If a draft contains nothing useful to keep. */
export function isEmptyDraft(draft: ComposerDraft): boolean {
  return (
    draft.title.trim() === "" &&
    draft.content.trim() === "" &&
    draft.images.length === 0 &&
    draft.linkPreviews.length === 0 &&
    draft.tags.length === 0
  );
}

// A page that is put away possibly does not come back: a phone discards it, a
// tab closes. Thus, the code writes all that waits now, not after the pause.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flushDraft());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushDraft();
  });
}
