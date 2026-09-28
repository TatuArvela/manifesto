import type { Note, PublicLink, PublicLinkMode } from "@manifesto/shared";
import { Copy, Globe, KeyRound, Trash2 } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { formatDateTime, plural, t } from "../i18n/index.js";
import { askConfirmation } from "../state/confirm.js";
import { notes } from "../state/notesStore.js";
import {
  createPublicLink,
  listPublicLinks,
  publicLinksDialog,
  publicLinkUrl,
  revokePublicLink,
} from "../state/publicLinks.js";
import { showError, showSuccess } from "../state/ui.js";
import { Backdrop } from "./Backdrop.js";

const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";
const iconButtonClass =
  "inline-flex items-center justify-center p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-60 cursor-pointer";
const fieldClass =
  "w-full min-w-0 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

/** The expiries offered, in days; 0 is never. */
const EXPIRY_DAYS = [0, 1, 7, 30] as const;

/**
 * The one public links dialog, mounted by `App` and opened by setting
 * `publicLinksDialog`. A note that disappears while it is open closes it.
 */
export function PublicLinksDialogHost() {
  const open = publicLinksDialog.value;
  const note = open ? notes.value.find((n) => n.id === open.noteId) : null;

  useEffect(() => {
    if (open && !note) publicLinksDialog.value = null;
  }, [open, note]);

  if (!open || !note) return null;
  return (
    <PublicLinksDialog
      note={note}
      onClose={() => {
        publicLinksDialog.value = null;
      }}
    />
  );
}

async function copyLink(token: string) {
  try {
    await navigator.clipboard.writeText(publicLinkUrl(token));
    showSuccess(t("noteCard.linkCopied"));
  } catch {
    showError(t("publicLink.copyFailed"));
  }
}

/**
 * A note's public links: made here, listed with how often each was opened,
 * and revoked here, which stops a link at once.
 */
function PublicLinksDialog({
  note,
  onClose,
}: {
  note: Note;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<PublicLink[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  useEffect(() => {
    let cancelled = false;
    void listPublicLinks(note.id).then((listed) => {
      if (cancelled) return;
      if (listed) setLinks(listed);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [note.id]);

  const revoke = async (link: PublicLink) => {
    const confirmed = await askConfirmation({
      title: t("publicLink.revoke.title"),
      body: t("publicLink.revoke.body"),
      confirmLabel: t("publicLink.revoke"),
    });
    if (!confirmed) return;
    if (await revokePublicLink(note.id, link.token)) {
      setLinks((held) => held?.filter((l) => l.token !== link.token) ?? null);
    } else {
      showError(t("publicLink.revokeFailed"));
    }
  };

  return createPortal(
    <>
      <Backdrop onDismiss={onClose} class="z-[60]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="public-links-title"
        class="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none animate-scale-in"
      >
        <div class="pointer-events-auto w-full max-w-md max-h-full overflow-y-auto overscroll-contain rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xl border border-neutral-200 dark:border-neutral-700 p-5 sm:p-6 flex flex-col gap-4">
          <div class="min-w-0">
            <h2 id="public-links-title" class="text-lg font-semibold">
              {t("publicLink.dialog.title")}
            </h2>
            <p class="text-sm text-neutral-500 dark:text-neutral-400 truncate">
              {note.title || t("sharing.untitled")}
            </p>
          </div>

          <p class="text-sm text-neutral-600 dark:text-neutral-300">
            {t("publicLink.dialog.explain")}
          </p>

          <CreateLinkForm
            noteId={note.id}
            onCreated={(link) => {
              setLinks((held) => [link, ...(held ?? [])]);
              void copyLink(link.token);
            }}
          />

          {failed ? (
            <p role="alert" class="text-sm text-red-600 dark:text-red-400">
              {t("publicLink.loadFailed")}
            </p>
          ) : links && links.length > 0 ? (
            <ul class="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-700">
              {links.map((link) => (
                <LinkRow
                  key={link.token}
                  link={link}
                  onRevoke={() => revoke(link)}
                />
              ))}
            </ul>
          ) : links ? (
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {t("publicLink.dialog.none")}
            </p>
          ) : null}

          <div class="flex justify-end">
            <button
              type="button"
              class="px-3 py-1.5 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 cursor-pointer"
              onClick={onClose}
            >
              {t("publicLink.dialog.done")}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function CreateLinkForm({
  noteId,
  onCreated,
}: {
  noteId: string;
  onCreated: (link: PublicLink) => void;
}) {
  const [mode, setMode] = useState<PublicLinkMode>("live");
  const [days, setDays] = useState<number>(0);
  const [maxViews, setMaxViews] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const views = Number.parseInt(maxViews, 10);
    const link = await createPublicLink(noteId, {
      mode,
      ...(days > 0 && { expiresInDays: days }),
      ...(Number.isFinite(views) && views > 0 && { maxViews: views }),
      ...(password && { password }),
    });
    setBusy(false);
    if (!link) {
      showError(t("publicLink.createFailed"));
      return;
    }
    setPassword("");
    setMaxViews("");
    onCreated(link);
  };

  return (
    <form
      onSubmit={submit}
      class="grid grid-cols-2 gap-2 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/40 border border-neutral-200 dark:border-neutral-600"
    >
      <label class="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
        {t("publicLink.form.mode")}
        <select
          class={fieldClass}
          value={mode}
          onChange={(e) =>
            setMode(
              (e.currentTarget as HTMLSelectElement).value as PublicLinkMode,
            )
          }
        >
          <option value="live">{t("publicLink.mode.live")}</option>
          <option value="snapshot">{t("publicLink.mode.snapshot")}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
        {t("publicLink.form.expires")}
        <select
          class={fieldClass}
          value={String(days)}
          onChange={(e) =>
            setDays(Number((e.currentTarget as HTMLSelectElement).value))
          }
        >
          {EXPIRY_DAYS.map((d) => (
            <option key={d} value={String(d)}>
              {d === 0
                ? t("publicLink.form.never")
                : plural("publicLink.form.days", d)}
            </option>
          ))}
        </select>
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
        {t("publicLink.form.maxViews")}
        <input
          class={fieldClass}
          type="number"
          min={1}
          inputMode="numeric"
          placeholder={t("publicLink.form.unlimited")}
          value={maxViews}
          onInput={(e) => setMaxViews((e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="flex flex-col gap-1 text-xs text-neutral-600 dark:text-neutral-300">
        {t("publicLink.form.password")}
        <input
          class={fieldClass}
          type="password"
          autoComplete="new-password"
          placeholder={t("publicLink.form.optional")}
          value={password}
          onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
        />
      </label>
      <p class="col-span-2 text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          mode === "live"
            ? "publicLink.mode.liveHint"
            : "publicLink.mode.snapshotHint",
        )}
      </p>
      <button
        type="submit"
        class={`${primaryButtonClass} col-span-2`}
        disabled={busy}
      >
        <Globe class="w-4 h-4" />
        {t("publicLink.form.create")}
      </button>
    </form>
  );
}

function LinkRow({
  link,
  onRevoke,
}: {
  link: PublicLink;
  onRevoke: () => void;
}) {
  const expired =
    link.expiresAt !== null && Date.parse(link.expiresAt) <= Date.now();
  const usedUp = link.maxViews !== null && link.viewCount >= link.maxViews;
  const views =
    link.maxViews === null
      ? plural("publicLink.views", link.viewCount)
      : plural("publicLink.viewsOf", link.viewCount, { max: link.maxViews });

  return (
    <li class="flex items-center gap-2 py-2">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium flex items-center gap-1.5">
          {t(
            link.mode === "live"
              ? "publicLink.mode.live"
              : "publicLink.mode.snapshot",
          )}
          {link.hasPassword && (
            <KeyRound
              class="w-3.5 h-3.5 text-neutral-500"
              aria-label={t("publicLink.hasPassword")}
            />
          )}
        </p>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          {views}
          {" · "}
          {expired || usedUp
            ? t("publicLink.stopped")
            : link.expiresAt
              ? t("publicLink.expires", {
                  date: formatDateTime(link.expiresAt),
                })
              : t("publicLink.noExpiry")}
        </p>
      </div>
      <button
        type="button"
        class={iconButtonClass}
        aria-label={t("publicLink.copy")}
        title={t("publicLink.copy")}
        onClick={() => void copyLink(link.token)}
      >
        <Copy class="w-4 h-4" />
      </button>
      <button
        type="button"
        class={`${iconButtonClass} text-red-600 dark:text-red-400`}
        aria-label={t("publicLink.revoke")}
        title={t("publicLink.revoke")}
        onClick={onRevoke}
      >
        <Trash2 class="w-4 h-4" />
      </button>
    </li>
  );
}
