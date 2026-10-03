import {
  MAX_COMMENT_LENGTH,
  type Note,
  type NoteComment,
  roleOf,
} from "@manifesto/shared";
import { MessageSquare, Pencil, Trash2 } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { formatDateTime, plural, t } from "../i18n/index.js";
import { currentUser } from "../state/auth.js";
import {
  addComment,
  deleteComment,
  editComment,
  forgetComments,
  loadComments,
  noteComments,
} from "../state/comments.js";
import { askConfirmation } from "../state/confirm.js";
import { serverFeature } from "../state/serverFeatures.js";
import { Avatar } from "./Avatar.js";

const fieldClass =
  "w-full rounded-lg border border-black/15 dark:border-white/15 bg-white/60 dark:bg-black/20 px-2 py-1.5 text-sm max-sm:text-base focus:outline-none focus:ring-2 focus:ring-blue-500";
const quietButton =
  "px-2 py-1 text-xs rounded-md cursor-pointer text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50";
const sendButton =
  "px-3 py-1 text-xs font-medium rounded-md cursor-pointer bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white";

/** A field for a comment's text: sent with the button or Mod+Enter. */
function CommentField({
  initial = "",
  label,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  label: string;
  submitLabel: string;
  /** Resolves true when the text was taken, which empties the field. */
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: (() => void) | undefined;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const body = text.trim();
  const submit = async () => {
    if (busy || body.length === 0) return;
    setBusy(true);
    const ok = await onSubmit(body);
    setBusy(false);
    if (ok) setText("");
  };
  return (
    <form
      class="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        class={fieldClass}
        rows={2}
        maxLength={MAX_COMMENT_LENGTH}
        aria-label={label}
        placeholder={label}
        value={text}
        onInput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div class="flex justify-end gap-1.5">
        {onCancel && (
          <button type="button" class={quietButton} onClick={onCancel}>
            {t("comments.cancel")}
          </button>
        )}
        <button
          type="submit"
          class={sendButton}
          disabled={busy || body.length === 0}
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function CommentRow({
  comment,
  canWrite,
  isNoteOwner,
}: {
  comment: NoteComment;
  canWrite: boolean;
  isNoteOwner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  // Escape leaves the edit, before it reaches the note's editor behind it.
  useEscapeStack(editing, () => setEditing(false));
  const mine =
    comment.author !== null && comment.author.id === currentUser.value?.id;
  const name = comment.author
    ? comment.author.displayName || comment.author.username
    : t("comments.formerParticipant");

  const remove = async () => {
    const ok = await askConfirmation({
      title: t("comments.deleteConfirm"),
      confirmLabel: t("confirm.trash.action"),
    });
    if (ok) void deleteComment(comment);
  };

  return (
    <li class="flex gap-2">
      <Avatar
        name={comment.author ? name : "?"}
        color={comment.author?.avatarColor ?? "#9ca3af"}
        class="w-6 h-6 text-[11px] shrink-0 mt-0.5"
      />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2 text-xs text-black/50 dark:text-white/50">
          <span
            class={`font-medium ${comment.author ? "text-black/80 dark:text-white/80" : "italic"}`}
          >
            {name}
          </span>
          <span>{formatDateTime(comment.createdAt)}</span>
          {comment.editedAt && (
            <span title={formatDateTime(comment.editedAt)}>
              {t("comments.edited")}
            </span>
          )}
        </div>
        {editing ? (
          <div class="mt-1">
            <CommentField
              initial={comment.body}
              label={t("comments.editLabel")}
              submitLabel={t("comments.save")}
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                const ok = await editComment(comment, body);
                if (ok) setEditing(false);
                return ok;
              }}
            />
          </div>
        ) : (
          <p class="text-sm whitespace-pre-wrap break-words">{comment.body}</p>
        )}
      </div>
      {!editing && (
        <div class="flex items-start shrink-0">
          {mine && canWrite && (
            <button
              type="button"
              class={quietButton}
              aria-label={t("comments.edit")}
              onClick={() => setEditing(true)}
            >
              <Pencil class="w-3.5 h-3.5" />
            </button>
          )}
          {(mine || isNoteOwner) && (
            <button
              type="button"
              class={quietButton}
              aria-label={t("comments.delete")}
              onClick={() => void remove()}
            >
              <Trash2 class="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The comments beside a shared note: a line saying how many, which opens the
 * list and a field to add one. Shown for a note that is shared, to everyone
 * on it; a note nobody else is on has nobody to talk to.
 *
 * Writing needs the server's sharing feature. With it off the comments
 * already made are still read and can still be deleted.
 */
export function NoteComments({ note }: { note: Note }) {
  const shared = note.sharing !== undefined;
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const noteId = note.id;

  useEffect(() => {
    if (!shared) return;
    let cancelled = false;
    void loadComments(noteId).then((ok) => {
      if (!cancelled) setFailed(!ok);
    });
    return () => {
      cancelled = true;
      forgetComments(noteId);
    };
  }, [noteId, shared]);

  if (!shared) return null;
  const comments = noteComments.value.get(noteId);
  const count = comments?.length ?? 0;
  const canWrite = serverFeature("sharing");

  return (
    <section class="mt-2" aria-label={t("comments.title")}>
      <button
        type="button"
        class="flex items-center gap-2 -ml-1 px-1 py-0.5 rounded-full text-xs text-black/50 dark:text-white/50 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MessageSquare class="w-4 h-4" />
        {comments === undefined
          ? t(failed ? "comments.loadFailed" : "comments.title")
          : count === 0
            ? t("comments.none")
            : plural("comments.count", count)}
      </button>
      {open && comments !== undefined && (
        <div class="mt-2 flex flex-col gap-3">
          {count > 0 && (
            <ul class="flex flex-col gap-3 max-h-64 overflow-y-auto pr-1">
              {comments.map((comment) => (
                <CommentRow
                  key={comment.id}
                  comment={comment}
                  canWrite={canWrite}
                  isNoteOwner={roleOf(note) === "owner"}
                />
              ))}
            </ul>
          )}
          {canWrite && (
            <CommentField
              label={t("comments.placeholder")}
              submitLabel={t("comments.send")}
              onSubmit={(body) => addComment(noteId, body)}
            />
          )}
        </div>
      )}
    </section>
  );
}
