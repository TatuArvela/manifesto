import { NoteColor, type PublicNote } from "@manifesto/shared";
import { useEffect, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import { APP_NAME } from "../config.js";
import { t } from "../i18n/index.js";
import { revealApp } from "../splash.js";
import {
  loadPublicImage,
  openPublicNote,
  type PublicNoteResult,
  savePublicNote,
  unlockPublicNote,
} from "../state/publicLinks.js";
import { renderMarkdown } from "../utils/remarkRenderer.js";
import { rebaseEdit } from "../utils/textMerge.js";

/**
 * The page a public link opens, rendered in place of the app: no account, no
 * board, one note. It reads the note once (which counts a view), asks for the
 * password first when the link has one, and says the same thing however a
 * link fails, as the server does.
 */
export function PublicNotePage({ token }: { token: string }) {
  const [result, setResult] = useState<PublicNoteResult | null>(null);

  useEffect(() => {
    // Read once: a second read would count a second view.
    void openPublicNote(token).then(setResult);
  }, [token]);

  useEffect(() => {
    if (result) revealApp();
  }, [result]);

  useEffect(() => {
    if (result?.kind === "note") document.title = result.note.title || APP_NAME;
  }, [result]);

  if (!result) return null;
  return (
    <main class="min-h-dvh bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 flex flex-col items-center px-4 py-8 sm:py-12">
      <div class="w-full max-w-2xl flex-1">
        {result.kind === "note" ? (
          <PublicNoteView
            token={token}
            note={result.note}
            access={result.access}
            canEdit={result.canEdit}
          />
        ) : result.kind === "locked" ||
          result.kind === "wrong-password" ||
          result.kind === "too-many" ? (
          <PasswordForm
            token={token}
            problem={result.kind === "locked" ? null : result.kind}
            onResult={setResult}
          />
        ) : (
          <p class="text-center text-neutral-600 dark:text-neutral-300 mt-16">
            {t(
              result.kind === "gone"
                ? "publicLink.page.gone"
                : "publicLink.page.failed",
            )}
          </p>
        )}
      </div>
      <p class="mt-8 text-xs text-neutral-500 dark:text-neutral-400">
        {t("publicLink.page.footer")}
      </p>
    </main>
  );
}

function PasswordForm({
  token,
  problem,
  onResult,
}: {
  token: string;
  problem: "wrong-password" | "too-many" | null;
  onResult: (result: PublicNoteResult) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    const result = await unlockPublicNote(token, password);
    setBusy(false);
    onResult(result);
  };

  return (
    <form
      onSubmit={submit}
      class="mx-auto mt-16 max-w-sm rounded-2xl bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-sm p-5 flex flex-col gap-3"
    >
      <label for="public-link-password" class="text-sm font-medium">
        {t("publicLink.page.passwordPrompt")}
      </label>
      <input
        id="public-link-password"
        type="password"
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: the password is the only thing this page asks for
        autoFocus
        value={password}
        onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        class="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {problem && (
        <p role="alert" class="text-sm text-red-600 dark:text-red-400">
          {t(
            problem === "wrong-password"
              ? "publicLink.page.wrongPassword"
              : "publicLink.page.tooMany",
          )}
        </p>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        class="inline-flex items-center justify-center px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
      >
        {t("publicLink.page.open")}
      </button>
    </form>
  );
}

/** The text being edited, and the copy of the note it was started from. */
interface Draft {
  title: string;
  content: string;
  base: PublicNote;
}

type SaveStatus = "saved" | "merged" | "conflict" | "failed" | "too-many";

const STATUS_MESSAGE = {
  saved: "publicLink.page.saved",
  merged: "publicLink.page.merged",
  conflict: "publicLink.page.conflict",
  failed: "publicLink.page.saveFailed",
  "too-many": "publicLink.page.saveTooMany",
} as const;

const editFieldClass =
  "w-full rounded-lg border border-black/15 dark:border-white/15 bg-white/70 dark:bg-black/20 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

function PublicNoteView({
  token,
  note: opened,
  access,
  canEdit,
}: {
  token: string;
  note: PublicNote;
  access: string | null;
  /** The link lets its holder change the title and text. */
  canEdit: boolean;
}) {
  // The note as last heard from the server: as opened, then as each save or
  // refused save reported it.
  const [note, setNote] = useState(opened);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<SaveStatus | null>(null);
  const colors = noteColorMap[note.color] ?? noteColorMap[NoteColor.Default];
  const font = noteFontFamilies[note.font] || undefined;
  const contentHtml = note.content ? renderMarkdown(note.content) : "";

  /**
   * Saves the draft on top of the copy it was started from. When someone
   * else changed the note meanwhile, the edit is replayed onto their text
   * where that can be done without guessing, and sent once more; where it
   * cannot, nothing is written: the page shows how the note stands, the
   * draft stays, and saving again is then a choice made knowing both.
   */
  const save = async () => {
    if (!draft || busy) return;
    setBusy(true);
    setStatus(null);
    const changes = { title: draft.title, content: draft.content };
    let result = await savePublicNote(
      token,
      changes,
      draft.base.updatedAt,
      access,
    );
    let merged = false;
    if (result.kind === "conflict") {
      const theirs = result.note;
      const content = rebaseEdit(
        draft.base.content,
        draft.content,
        theirs.content,
      );
      if (content !== null) {
        const title =
          draft.title === draft.base.title ? theirs.title : draft.title;
        result = await savePublicNote(
          token,
          { title, content },
          theirs.updatedAt,
          access,
        );
        merged = result.kind === "saved";
      }
    }
    setBusy(false);
    if (result.kind === "saved") {
      setNote(result.note);
      setDraft(null);
      setStatus(merged ? "merged" : "saved");
    } else if (result.kind === "conflict") {
      setNote(result.note);
      setDraft({ ...draft, base: result.note });
      setStatus("conflict");
    } else {
      setStatus(result.kind === "too-many" ? "too-many" : "failed");
    }
  };

  return (
    <article
      class={`${colors.bg} ${colors.border} border rounded-xl shadow-sm px-5 py-5 sm:px-8 sm:py-7`}
    >
      {canEdit && !draft && (
        <div class="flex items-center justify-end gap-3 mb-2">
          {status && (
            <span role="status" class="text-xs opacity-70">
              {t(STATUS_MESSAGE[status])}
            </span>
          )}
          <button
            type="button"
            class="inline-flex items-center px-3 py-1 text-sm rounded-lg font-medium bg-black/10 dark:bg-white/15 hover:bg-black/15 dark:hover:bg-white/20 cursor-pointer"
            onClick={() => {
              setStatus(null);
              setDraft({
                title: note.title,
                content: note.content,
                base: note,
              });
            }}
          >
            {t("publicLink.page.edit")}
          </button>
        </div>
      )}
      {note.title && (
        <h1
          class="text-xl sm:text-2xl font-medium leading-snug mb-3 break-words"
          style={{ fontFamily: font }}
        >
          {note.title}
        </h1>
      )}
      {contentHtml && (
        <div
          class="prose dark:prose-invert max-w-none break-words"
          style={{ fontFamily: font }}
          // Sanitized by `renderMarkdown` (DOMPurify), as everywhere else.
          dangerouslySetInnerHTML={{ __html: contentHtml }}
        />
      )}
      {draft && (
        <form
          class="mt-4 pt-4 border-t border-black/10 dark:border-white/10 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label class="flex flex-col gap-1 text-xs font-medium">
            {t("publicLink.page.titleLabel")}
            <input
              class={editFieldClass}
              maxLength={500}
              value={draft.title}
              onInput={(e) =>
                setDraft({
                  ...draft,
                  title: (e.currentTarget as HTMLInputElement).value,
                })
              }
            />
          </label>
          <label class="flex flex-col gap-1 text-xs font-medium">
            {t("publicLink.page.textLabel")}
            <textarea
              class={`${editFieldClass} font-mono text-sm min-h-48`}
              maxLength={100_000}
              value={draft.content}
              onInput={(e) =>
                setDraft({
                  ...draft,
                  content: (e.currentTarget as HTMLTextAreaElement).value,
                })
              }
            />
          </label>
          {status && (
            <p role="alert" class="text-sm">
              {t(STATUS_MESSAGE[status])}
            </p>
          )}
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-lg hover:bg-black/10 dark:hover:bg-white/10 cursor-pointer"
              onClick={() => {
                setDraft(null);
                setStatus(null);
              }}
            >
              {t("publicLink.page.cancel")}
            </button>
            <button
              type="submit"
              disabled={busy}
              class="px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
            >
              {t("publicLink.page.save")}
            </button>
          </div>
        </form>
      )}
      {note.images.length > 0 && (
        <div class="mt-4 grid gap-2 grid-cols-1 sm:grid-cols-2">
          {note.images.map((ref) => (
            <PublicImage
              key={ref}
              token={token}
              imageRef={ref}
              access={access}
            />
          ))}
        </div>
      )}
      {note.linkPreviews.length > 0 && (
        <ul class="mt-4 flex flex-col gap-2">
          {note.linkPreviews.map((preview) => (
            <li key={preview.url}>
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                class="block rounded-lg bg-black/5 dark:bg-white/10 px-3 py-2 hover:bg-black/10 dark:hover:bg-white/15"
              >
                <span class="block text-sm font-medium truncate">
                  {preview.title || preview.url}
                </span>
                <span class="block text-xs text-neutral-500 dark:text-neutral-400 truncate">
                  {preview.domain}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function PublicImage({
  token,
  imageRef,
  access,
}: {
  token: string;
  imageRef: string;
  access: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let created: string | null = null;
    let cancelled = false;
    void loadPublicImage(token, imageRef, access).then((loaded) => {
      if (cancelled) {
        if (loaded) URL.revokeObjectURL(loaded);
        return;
      }
      created = loaded;
      setUrl(loaded);
    });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [token, imageRef, access]);

  if (!url) return null;
  return <img src={url} alt="" class="w-full rounded-lg object-cover" />;
}
