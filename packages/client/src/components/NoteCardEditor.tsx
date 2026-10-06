import type { Note, NoteColor } from "@manifesto/shared";
import { type Editor, EditorStatus } from "@milkdown/kit/core";
import { replaceAll } from "@milkdown/kit/utils";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { formatDateTime, t } from "../i18n/index.js";
import {
  localAgreement,
  sharedAgreement,
} from "../realtime/contentAgreement.js";
import { useNoteYDoc } from "../realtime/yjsProvider.js";
import { forceUpdateApp } from "../serviceWorker.js";
import {
  addLinkPreviews,
  addTag,
  ensureImages,
  notes,
  showError,
  togglePin,
  updateNote,
  updateStoredNote,
} from "../state/index.js";
import { recordVersion } from "../state/versions.js";
import { isPhoneLayout } from "../utils/phoneSheets.js";
import { Backdrop } from "./Backdrop.js";
import { getEditorMarkdown } from "./MilkdownEditor.js";
import { NoteEditor } from "./NoteEditor.js";
import { noteMenuItems } from "./NoteMenu.js";
import { NoteSheet } from "./NoteSheet.js";
import { SharedPeople } from "./SharedAvatars.js";
import { VersionHistory } from "./VersionHistory.js";

/**
 * How long a changed row waits before it is judged to have come from outside
 * the document. Another tab's save reaches this one twice, as a broadcast
 * over `/api/ws` and as its claim over `/api/yjs`, and nothing orders the two
 * sockets; judged before the claim arrives, that save would look like an
 * outside write and be written in over whatever was typed since.
 */
const PEER_RECORD_DELAY_MS = 1000;

export function NoteCardEditor({
  note,
  onClose,
}: {
  note: Note;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const { ydoc, awareness, synced, outdated } = useNoteYDoc(note.id);
  // Withheld until the provider has synced; see NoteYDoc.synced. NoteEditor
  // keys the editor on this, so it remounts once collaboration is ready.
  const collab =
    ydoc && synced ? { ydoc, awareness: awareness ?? undefined } : undefined;
  const collaborating = collab !== undefined;
  // Which texts of the row came from the document; see `contentAgreement`.
  const openedRowRef = useRef({
    content: note.content,
    updatedAt: note.updatedAt,
  });
  const agreement = useMemo(
    () =>
      ydoc && synced
        ? sharedAgreement(ydoc, awareness)
        : localAgreement(openedRowRef.current),
    [ydoc, awareness, synced],
  );
  const agreementRef = useRef(agreement);
  agreementRef.current = agreement;
  const [editor, setEditor] = useState<Editor | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [showVersions, setShowVersions] = useState(false);
  const [versionsClosing, setVersionsClosing] = useState(false);
  const versionsCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const closeVersions = () => {
    setVersionsClosing(true);
    if (versionsCloseTimerRef.current)
      clearTimeout(versionsCloseTimerRef.current);
    versionsCloseTimerRef.current = setTimeout(() => {
      versionsCloseTimerRef.current = null;
      setShowVersions(false);
      setVersionsClosing(false);
    }, 150);
  };

  // Capture original state for version history (set once on mount)
  const originalTitleRef = useRef(note.title);
  const originalContentRef = useRef(note.content);

  // Track what we've actually persisted, NOT the mount-time prop snapshot. If
  // a WS `note:updated` event arrives mid-edit, `note.title` becomes the new
  // server value and a naive `title !== note.title` guard would fire a no-op
  // (or stale-overwriting) save. Comparing against savedRef instead means
  // we only ever write when the local state diverges from what we ourselves
  // last sent.
  const savedTitleRef = useRef(note.title);
  const savedContentRef = useRef(note.content);

  const savedRef = useRef(false);

  /** Every save of what the editor holds goes through here, so the document
   * records each text it sent and each save that landed. */
  const saveText = useCallback(
    (title: string, content: string) => {
      const records = agreementRef.current;
      records.claim(content);
      void updateStoredNote(note.id, { title, content }).then((saved) => {
        if (saved) records.confirm(saved.updatedAt);
      });
    },
    [note.id],
  );

  const maybeSaveVersion = () => {
    if (
      title !== originalTitleRef.current ||
      content !== originalContentRef.current
    ) {
      void recordVersion(
        note.id,
        originalTitleRef.current,
        originalContentRef.current,
      );
    }
  };

  const titleRef = useRef(title);
  const contentRef = useRef(content);
  titleRef.current = title;
  contentRef.current = content;

  const saveAndCloseRef = useRef<() => void>(() => {});
  saveAndCloseRef.current = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (
      title !== savedTitleRef.current ||
      content !== savedContentRef.current
    ) {
      savedTitleRef.current = title;
      savedContentRef.current = content;
      saveText(title, content);
    }
    maybeSaveVersion();
    savedRef.current = true;
    onClose();
  };
  const saveAndClose = () => saveAndCloseRef.current();

  // Save pending changes on unmount (e.g. backdrop click). A layout effect,
  // so the save happens as the editor goes: an effect's cleanup waits for the
  // paint, and a tab closed in between would lose the edit.
  useLayoutEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (savedRef.current) return;
      if (
        titleRef.current !== savedTitleRef.current ||
        contentRef.current !== savedContentRef.current
      ) {
        savedTitleRef.current = titleRef.current;
        savedContentRef.current = contentRef.current;
        saveText(titleRef.current, contentRef.current);
      }
      // Save version if content changed during this editing session
      if (
        titleRef.current !== originalTitleRef.current ||
        contentRef.current !== originalContentRef.current
      ) {
        void recordVersion(
          note.id,
          originalTitleRef.current,
          originalContentRef.current,
        );
      }
    };
  }, [note.id, saveText]);

  // Escape saves and closes. The version panel and any picker opened from
  // inside the editor register after this one and take the key first, so a
  // press over the version panel closes the panel, not the editor.
  useEscapeStack(true, () => saveAndCloseRef.current());
  useEscapeStack(showVersions && !versionsClosing, closeVersions);
  const versionsRef = useFocusTrap<HTMLDivElement>(
    showVersions && !versionsClosing,
  );

  // The editor is one of the places that needs the bytes, not the count: its
  // "add an image" handler writes `[...note.images, ...urls]`, and doing that
  // against a list a listing had emptied would delete every attachment the
  // note already had. Starting the fetch here is what makes it arrive before
  // the user reaches for it, but it is not what makes it safe: the handlers
  // below await it themselves, because this one is still in flight during the
  // first moments the editor is open and may have failed after that.
  useEffect(() => {
    void ensureImages(note.id);
  }, [note.id]);

  /**
   * The note's attachments, or `null` if they could not be fetched.
   *
   * Every write to `images` has to go through this. `note.images` on its own
   * is `[]` both before the load lands and after it fails, and writing
   * `[...note.images, ...urls]` from either state PATCHes a list holding only
   * the new file, which the server takes as the whole set and the other
   * attachments are gone, on every device.
   */
  const currentImages = async (): Promise<string[] | null> => {
    const images = await ensureImages(note.id);
    if (images === null) showError(t("error.imagesUnavailable"));
    return images;
  };

  // Auto-save on any title/content change
  useEffect(() => {
    if (title === savedTitleRef.current && content === savedContentRef.current)
      return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      savedTitleRef.current = title;
      savedContentRef.current = content;
      saveText(title, content);
    }, 500);
  }, [title, content, saveText]);

  // A row written from outside the document (an assistant, a script on the
  // REST API, a restored version) is written into it, by one client only, and
  // not saved back: the row already holds it, so it is claimed instead. When
  // the document also held text never saved, that text is kept as a version
  // before it is replaced. Judged at once when an editor arrives, since the
  // records came with the sync; later changes wait for peers' records.
  const judgedEditorRef = useRef<Editor | null>(null);
  useEffect(() => {
    if (!editor) return;
    const first = judgedEditorRef.current !== editor;
    judgedEditorRef.current = editor;
    const timer = setTimeout(
      () => {
        // The editor this was scheduled for may be gone by now: the solo one
        // is torn down when collaboration arrives, and a destroyed editor
        // throws on every read of its view.
        if (editor.status !== EditorStatus.Created) return;
        const row = notes.value.find((n) => n.id === note.id);
        if (!row) return;
        const records = agreementRef.current;
        const documentText = getEditorMarkdown(editor);
        if (!records.isOutside(row, documentText)) {
          if (records.wasClaimed(documentText) || !records.leads()) return;
          // Row and document agree: a document from before the records
          // starts keeping them here.
          if (documentText.trimEnd() === row.content.trimEnd()) {
            records.claim(row.content);
            records.confirm(row.updatedAt);
          }
          return;
        }
        if (!records.leads()) return;
        if (!records.wasClaimed(documentText)) {
          void recordVersion(note.id, titleRef.current, documentText);
        }
        records.claim(row.content);
        editor.action(replaceAll(row.content));
        const adopted = getEditorMarkdown(editor);
        savedContentRef.current = adopted;
        setContent(adopted);
      },
      first || !collaborating ? 0 : PEER_RECORD_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [editor, note.id, note.content, note.updatedAt, agreement, collaborating]);

  return (
    <>
      {showVersions && (
        <NoteSheet
          label={t("noteMenu.versionHistory")}
          dialogRef={versionsRef}
          layer="z-[70]"
          motion={`transition-all duration-150 ${versionsClosing ? "opacity-0 sm:scale-95" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
          backdrop={
            <Backdrop
              onDismiss={closeVersions}
              closing={versionsClosing}
              class="z-[60]"
            />
          }
          closing={versionsClosing}
          onBack={closeVersions}
        >
          <VersionHistory
            noteId={note.id}
            color={note.color}
            onRestore={(restoredTitle, restoredContent) => {
              setTitle(restoredTitle);
              setContent(restoredContent);
              savedTitleRef.current = restoredTitle;
              savedContentRef.current = restoredContent;
              void updateNote(note.id, {
                title: restoredTitle,
                content: restoredContent,
              });
              closeVersions();
            }}
            onClose={closeVersions}
          />
        </NoteSheet>
      )}
      <NoteEditor
        title={title}
        onTitleChange={setTitle}
        content={content}
        onContentChange={setContent}
        color={note.color}
        onColorChange={(color) =>
          updateNote(note.id, { color: color as NoteColor })
        }
        font={note.font}
        onFontChange={(font) => updateNote(note.id, { font })}
        images={note.images}
        onAddImages={async (urls) => {
          const images = await currentImages();
          if (images === null) return;
          await updateNote(note.id, { images: [...images, ...urls] });
        }}
        onRemoveImage={async (index) => {
          const images = await currentImages();
          if (images === null) return;
          await updateNote(note.id, {
            images: images.filter((_, i) => i !== index),
          });
        }}
        linkPreviews={note.linkPreviews}
        onAddLinkPreviews={(urls) => addLinkPreviews(note.id, urls)}
        onRemoveLinkPreview={(index) =>
          updateNote(note.id, {
            linkPreviews: note.linkPreviews.filter((_, i) => i !== index),
          })
        }
        pinned={note.pinned}
        onPinToggle={() => togglePin(note.id)}
        tags={note.tags}
        onAddTag={(tag) => addTag(note.id, tag)}
        onRemoveTag={(tag) =>
          updateNote(note.id, { tags: note.tags.filter((t) => t !== tag) })
        }
        reminder={note.reminder}
        onReminderChange={(reminder) => updateNote(note.id, { reminder })}
        menuItems={({ checkedItems }) =>
          noteMenuItems(note, {
            // The live buffer, not the stored note: auto-save is debounced, and
            // duplicating or sharing right after a keystroke must copy it.
            draft: { title, content },
            onShowVersions: () => setShowVersions(true),
            checkedItems,
            // Archiving, trashing and restoring all move the note out of the
            // view it was opened from, so leaving the editor up would strand
            // it over a grid the note is no longer in.
            onDismiss: onClose,
          })
        }
        onDone={saveAndClose}
        metadata={
          <>
            <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-3 text-xs text-black/40 dark:text-white/40">
              <span>
                {t("editor.metadata.created", {
                  date: formatDateTime(note.createdAt),
                })}
              </span>
              {note.updatedAt !== note.createdAt && (
                <span>
                  {t("editor.metadata.edited", {
                    date: formatDateTime(note.updatedAt),
                  })}
                </span>
              )}
            </div>
            <SharedPeople note={note} />
          </>
        }
        // A phone opens a note to read it. The focus would come too late after
        // the tap for iOS to raise the keyboard, so all it did was send the
        // caret to the end, where the first tap into the text then had to
        // move it from. A tap puts it where it lands instead.
        autoFocus={!isPhoneLayout()}
        onEditorReady={setEditor}
        collab={collab}
        // The server refused this build's editor. Saving the text over REST
        // instead would write this build's reading of it over whatever newer
        // content it failed to understand, so the text waits for a reload.
        contentLocked={outdated}
        notice={outdated && <OutdatedEditorNotice />}
      />
    </>
  );
}

function OutdatedEditorNotice() {
  return (
    <div
      role="status"
      class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10"
    >
      <span class="flex-1">{t("editor.outdated")}</span>
      <button
        type="button"
        class="font-medium underline underline-offset-2"
        // The installed copy is what is out of date, so an ordinary reload
        // could come back to the same one.
        onClick={() => void forceUpdateApp()}
      >
        {t("editor.outdated.reload")}
      </button>
    </div>
  );
}
