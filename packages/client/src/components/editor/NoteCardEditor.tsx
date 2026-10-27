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
import { Backdrop } from "#/components/Backdrop.tsx";
import { noteMenuItems } from "#/components/card/noteMenuItems.tsx";
import { NoteComments } from "#/components/NoteComments.tsx";
import { NoteSheet } from "#/components/NoteSheet.tsx";
import { SharedPeople } from "#/components/sharing/SharedAvatars.tsx";
import { VersionHistory } from "#/components/VersionHistory.tsx";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useVersionsPanel } from "#/hooks/useVersionsPanel.ts";
import { formatDateTime, t } from "#/i18n/index.ts";
import {
  localAgreement,
  sharedAgreement,
} from "#/realtime/contentAgreement.ts";
import { useNoteYDoc } from "#/realtime/yjsProvider.ts";
import { forceUpdateApp } from "#/serviceWorker.ts";
import { addTag, describeImage, togglePin } from "#/state/actions.ts";
import { takeEditorIntent } from "#/state/editorIntent.ts";
import { addLinkPreviews } from "#/state/linkPreviews.ts";
import {
  ensureImages,
  notes,
  updateNote,
  updateStoredNote,
} from "#/state/notesStore.ts";
import { showError } from "#/state/ui.ts";
import {
  type NoteBefore,
  recordVersion,
  versionToKeep,
} from "#/state/versions.ts";
import { placedImageAlts, placeImages } from "#/utils/drawing.ts";
import { isPhoneLayout } from "#/utils/phoneSheets.ts";
import { getEditorMarkdown } from "./MilkdownEditor.tsx";
import { NoteEditor } from "./NoteEditor.tsx";

/**
 * How long a changed row waits before the code decides that it came from
 * outside the document. The save of a different tab reaches this tab two times:
 * as a broadcast over `/api/v1/ws`, and as its claim over `/api/v1/yjs`.
 * Nothing puts the two sockets in order. If the code judged that save before
 * the claim arrived, it would look like an outside write, and the code would
 * write it over what was typed since then.
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
  // What the card asked for when it opened this editor, if anything.
  const [intent] = useState(() => takeEditorIntent(note.id));
  const { ydoc, awareness, synced, outdated, unreadable } = useNoteYDoc(
    note.id,
  );
  // Not given until the provider synced. See NoteYDoc.synced. NoteEditor uses
  // this as the key of the editor. Thus, the editor mounts again when
  // collaboration is ready.
  const collab =
    ydoc && synced ? { ydoc, awareness: awareness ?? undefined } : undefined;
  const collaborating = collab !== undefined;
  // Which texts of the row came from the document. See `contentAgreement`.
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
  // Record the original state for the version history (set one time on mount,
  // and the images when they arrive).
  const beforeRef = useRef<NoteBefore>({
    title: note.title,
    content: note.content,
    images: null,
  });

  // Record what we really saved, NOT the snapshot of the prop at mount. If a WS
  // `note:updated` event arrives during an edit, `note.title` becomes the new
  // server value, and a naive `title !== note.title` guard would fire a save
  // that does nothing (or that overwrites with old data). A comparison against
  // savedRef means that we only write when the local state is different from
  // what we sent last.
  const savedTitleRef = useRef(note.title);
  const savedContentRef = useRef(note.content);

  const savedRef = useRef(false);

  /**
   * Each save of the content of the editor goes through here. Thus, the
   * document records each text that it sent, and each save that arrived.
   */
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
    const version = versionToKeep(note.id, beforeRef.current, title, content);
    if (version) void recordVersion(note.id, version);
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

  // Save the waiting changes on unmount (for example, a backdrop click). A
  // layout effect. Thus, the save occurs when the editor goes. The cleanup of
  // an effect waits for the paint, and a tab closed between them would lose the
  // edit.
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
      // Save a version if the note changed during this editing session.
      const version = versionToKeep(
        note.id,
        beforeRef.current,
        titleRef.current,
        contentRef.current,
      );
      if (version) void recordVersion(note.id, version);
    };
  }, [note.id, saveText]);

  // Escape saves and closes. The version panel and all pickers opened from
  // inside the editor register after this one, and take the key first. Thus, a
  // press over the version panel closes the panel, not the editor.
  useEscapeStack(true, () => saveAndCloseRef.current());
  const versions = useVersionsPanel(intent?.kind === "versions");

  // The editor is one of the places that need the bytes, not the count. Its
  // "add an image" handler writes `[...note.images, ...urls]`. If it did that
  // against a list that a listing had emptied, it would delete each attachment
  // that the note already had. When the fetch starts here, it arrives before
  // the user needs it, but this does not make it safe. The handlers below await
  // it themselves, because this fetch is still in progress during the first
  // moments when the editor is open, and can fail after that.
  // The images that arrive first are those from before the session.
  useEffect(() => {
    void ensureImages(note.id).then((images) => {
      if (images === null || beforeRef.current.images !== null) return;
      const row = notes.value.find((n) => n.id === note.id);
      beforeRef.current.images = {
        images,
        ...(row?.imageAlts && { imageAlts: row.imageAlts }),
      };
    });
  }, [note.id]);

  /**
   * The attachments of the note, or `null` if the code could not get them.
   *
   * Each write to `images` must go through this. `note.images` alone is `[]`
   * before the load arrives and after it fails. A write of `[...note.images,
   * ...urls]` from either state PATCHes a list that contains only the new file.
   * The server takes it as the full set, and the other attachments are gone, on
   * all devices.
   */
  const currentImages = async (): Promise<string[] | null> => {
    const images = await ensureImages(note.id);
    if (images === null) showError(t("error.imagesUnavailable"));
    return images;
  };

  // Auto-save on each change of the title or the content.
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

  // A row written from outside the document (an assistant, a script on the REST
  // API, a restored version) is written into it, by one client only, and not
  // saved back. The row already contains it. Thus, the code claims it. When the
  // document also contained text that was never saved, the code keeps that text
  // as a version before it is replaced. When an editor arrives, the code judges
  // it immediately, because the records came with the sync. Later changes wait
  // for the records of the peers.
  const judgedEditorRef = useRef<Editor | null>(null);
  useEffect(() => {
    if (!editor) return;
    const first = judgedEditorRef.current !== editor;
    judgedEditorRef.current = editor;
    const timer = setTimeout(
      () => {
        // The editor for which this was scheduled can be gone now. The solo
        // editor is torn down when collaboration arrives, and a destroyed
        // editor throws on each read of its view.
        if (editor.status !== EditorStatus.Created) return;
        const row = notes.value.find((n) => n.id === note.id);
        if (!row) return;
        const records = agreementRef.current;
        const documentText = getEditorMarkdown(editor);
        if (!records.isOutside(row, documentText)) {
          if (records.wasClaimed(documentText) || !records.leads()) return;
          // The row and the document agree. A document from before the records
          // starts to keep them here.
          if (documentText.trimEnd() === row.content.trimEnd()) {
            records.claim(row.content);
            records.confirm(row.updatedAt);
          }
          return;
        }
        if (!records.leads()) return;
        if (!records.wasClaimed(documentText)) {
          void recordVersion(note.id, {
            title: titleRef.current,
            content: documentText,
          });
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
      {versions.shown && (
        <NoteSheet
          label={t("noteMenu.versionHistory")}
          dialogRef={versions.dialogRef}
          layer="layer-nested"
          motion={`transition-all duration-150 ${versions.closing ? "opacity-0 sm:scale-95" : "max-sm:animate-fade-in sm:animate-scale-in"}`}
          backdrop={
            <Backdrop
              onDismiss={versions.close}
              closing={versions.closing}
              class="layer-nested-backdrop"
            />
          }
          closing={versions.closing}
          onBack={versions.close}
        >
          <VersionHistory
            noteId={note.id}
            color={note.color}
            onRestore={(version) => {
              setTitle(version.title);
              setContent(version.content);
              savedTitleRef.current = version.title;
              savedContentRef.current = version.content;
              // A version from before images were kept leaves them as they are.
              void updateNote(note.id, {
                title: version.title,
                content: version.content,
                ...(version.images && {
                  images: version.images,
                  imageAlts: version.imageAlts ?? [],
                }),
              });
              versions.close();
            }}
            onClose={versions.close}
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
        imageAlts={note.imageAlts}
        initialFiles={intent?.kind === "attach" ? intent.files : undefined}
        onAddImages={async (urls, replaces) => {
          const images = await currentImages();
          if (images === null) return;
          const placed = placeImages(images, urls, replaces);
          const before = notes.value.find((n) => n.id === note.id) ?? note;
          const imageAlts = placedImageAlts(
            { images, imageAlts: before.imageAlts ?? [] },
            placed,
            urls,
            replaces,
          );
          await updateNote(note.id, {
            images: placed,
            ...(imageAlts.length > 0 && { imageAlts }),
          });
        }}
        onDescribeImage={(image, alt) =>
          void describeImage(note.id, image, alt)
        }
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
        menuItems={({ checkedItems, datedItems }) =>
          noteMenuItems(note, {
            // The live buffer, not the stored note. The auto-save is debounced,
            // and a duplicate or a share immediately after a keystroke must
            // copy it.
            draft: { title, content },
            onShowVersions: versions.open,
            checkedItems,
            datedItems,
            // Archive, trash and restore all move the note out of the view from
            // which it opened. Thus, if the editor stayed open, it would be
            // over a grid that does not contain the note now.
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
            <NoteComments note={note} />
          </>
        }
        // A phone opens a note to read it. The focus would come too late after
        // the tap for iOS to open the keyboard. Thus, it only sent the caret to
        // the end, and the first tap into the text then had to move it from
        // there. A tap puts it where it touches.
        autoFocus={!isPhoneLayout()}
        onEditorReady={setEditor}
        collab={collab}
        // The server refused the editor of this build. A save of the text over
        // REST would write the reading of this build over the newer content
        // that it did not understand. Thus, the text waits for a reload.
        contentLocked={outdated}
        notice={
          outdated ? (
            <OutdatedEditorNotice />
          ) : (
            unreadable > 0 && <UnopenedEditsNotice />
          )
        }
      />
    </>
  );
}

/** Some data written to the document of the note did not open here. */
function UnopenedEditsNotice() {
  return (
    <div
      role="status"
      class="mb-2 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/10"
    >
      {t("editor.unopenedEdits")}
    </div>
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
        // The installed copy is out of date. Thus, a usual reload could come
        // back to the same copy.
        onClick={() => void forceUpdateApp()}
      >
        {t("editor.outdated.reload")}
      </button>
    </div>
  );
}
