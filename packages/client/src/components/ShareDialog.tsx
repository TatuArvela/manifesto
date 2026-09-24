import {
  type DirectoryUser,
  type Note,
  type NoteMember,
  roleOf,
  type ShareRole,
  type ShareUser,
} from "@manifesto/shared";
import { LogOut, UserPlus, X } from "lucide-preact";
import { createPortal } from "preact/compat";
import { useEffect, useState } from "preact/hooks";
import { useEscapeStack } from "../hooks/useEscapeStack.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { t } from "../i18n/index.js";
import { currentUser, userLookupMode } from "../state/auth.js";
import { notes } from "../state/notesStore.js";
import {
  findUsers,
  leaveNote,
  removeShare,
  setShareRole,
  shareDialog,
  shareNote,
} from "../state/sharing.js";
import { Avatar } from "./Avatar.js";
import { Backdrop } from "./Backdrop.js";
import { Tooltip } from "./Tooltip.js";

const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";
const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-60 cursor-pointer";
const dangerButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 cursor-pointer";
const inputClass =
  "w-full min-w-0 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";
const selectClass =
  "rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-60";

/** How long the owner has to pause typing before a search goes out. */
const SEARCH_DELAY_MS = 250;

/**
 * The one share dialog, mounted by `App` and opened by setting `shareDialog`.
 * A note that disappears while it is open (its owner took this user off it)
 * closes it rather than leaving it talking about nothing.
 */
export function ShareDialogHost() {
  const open = shareDialog.value;
  const note = open ? notes.value.find((n) => n.id === open.noteId) : null;

  useEffect(() => {
    if (open && !note) shareDialog.value = null;
  }, [open, note]);

  if (!open || !note) return null;
  return (
    <ShareDialog
      note={note}
      onClose={() => {
        shareDialog.value = null;
      }}
    />
  );
}

function RoleSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: ShareRole;
  onChange: (role: ShareRole) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      class={selectClass}
      value={value}
      aria-label={label}
      disabled={disabled}
      onChange={(e) =>
        onChange((e.currentTarget as HTMLSelectElement).value as ShareRole)
      }
    >
      <option value="edit">{t("sharing.role.edit")}</option>
      <option value="view">{t("sharing.role.view")}</option>
    </select>
  );
}

/**
 * Who has a note. Its owner invites people, sets what each may do and takes
 * them off it; everyone else sees who is there and may leave.
 */
function ShareDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const me = currentUser.value;
  const role = roleOf(note);
  const isOwner = role === "owner";
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEscapeStack(true, onClose);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  const owner: ShareUser | null =
    note.sharing?.owner ??
    (me
      ? {
          id: me.id,
          username: me.username,
          displayName: me.displayName,
          avatarColor: me.avatarColor,
        }
      : null);
  const members = note.sharing?.members ?? [];
  const title = note.title || t("sharing.untitled");

  const leave = async () => {
    if (!me || busy) return;
    setBusy(true);
    const left = await leaveNote(note.id, me.id);
    setBusy(false);
    if (left) onClose();
  };

  return createPortal(
    <>
      <Backdrop onDismiss={onClose} class="z-[60]" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        class="fixed inset-0 z-[70] flex items-center justify-center p-4 pointer-events-none animate-scale-in"
      >
        <div class="pointer-events-auto w-full max-w-md max-h-full overflow-y-auto overscroll-contain rounded-2xl bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xl border border-neutral-200 dark:border-neutral-700 p-5 sm:p-6 flex flex-col gap-4">
          <div class="min-w-0">
            <h2 id="share-dialog-title" class="text-lg font-semibold">
              {t(isOwner ? "sharing.dialog.title" : "sharing.dialog.people")}
            </h2>
            <p class="text-sm text-neutral-500 dark:text-neutral-400 truncate">
              {title}
            </p>
          </div>

          {isOwner && (
            <AddPerson
              note={note}
              memberIds={new Set(members.map((m) => m.id))}
            />
          )}

          <ul class="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-700">
            {owner && (
              <PersonRow person={owner} isMe={owner.id === me?.id}>
                <span class="text-sm text-neutral-500 dark:text-neutral-400">
                  {t("sharing.role.owner")}
                </span>
              </PersonRow>
            )}
            {members.map((member) => (
              <MemberRow
                key={member.id}
                note={note}
                member={member}
                isMe={member.id === me?.id}
                canManage={isOwner}
              />
            ))}
          </ul>

          {isOwner && members.length === 0 && (
            <p class="text-sm text-neutral-500 dark:text-neutral-400">
              {t("sharing.dialog.nobody")}
            </p>
          )}

          {!isOwner &&
            (leaving ? (
              <div class="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-700/50 border border-neutral-200 dark:border-neutral-600">
                <p class="text-sm text-neutral-600 dark:text-neutral-300 mb-3">
                  {t("sharing.leave.confirm", {
                    name: owner?.displayName ?? "",
                  })}
                </p>
                <div class="flex flex-wrap gap-2">
                  <button
                    type="button"
                    class={dangerButtonClass}
                    disabled={busy}
                    onClick={leave}
                  >
                    {t("sharing.leave")}
                  </button>
                  <button
                    type="button"
                    class={secondaryButtonClass}
                    disabled={busy}
                    onClick={() => setLeaving(false)}
                  >
                    {t("sharing.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                class={`${secondaryButtonClass} self-start`}
                onClick={() => setLeaving(true)}
              >
                <LogOut class="w-4 h-4" />
                {t("sharing.leave")}
              </button>
            ))}

          <div class="flex justify-end">
            <button type="button" class={primaryButtonClass} onClick={onClose}>
              {t("sharing.done")}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

function PersonRow({
  person,
  isMe,
  secondary,
  children,
}: {
  person: ShareUser;
  isMe: boolean;
  secondary?: string;
  children?: preact.ComponentChildren;
}) {
  const name = person.displayName || person.username;
  const details = [
    name !== person.username ? person.username : null,
    secondary ?? null,
  ].filter((part): part is string => part !== null);
  return (
    <li class="flex items-center gap-3 py-2.5">
      <Avatar name={name} color={person.avatarColor} class="w-8 h-8 text-xs" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">
          {isMe ? t("sharing.you", { name }) : name}
        </p>
        {details.length > 0 && (
          <p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
            {details.join(" · ")}
          </p>
        )}
      </div>
      <div class="flex items-center gap-1 shrink-0">{children}</div>
    </li>
  );
}

function MemberRow({
  note,
  member,
  isMe,
  canManage,
}: {
  note: Note;
  member: NoteMember;
  isMe: boolean;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const name = member.displayName || member.username;

  const act = async (action: () => Promise<boolean>) => {
    setBusy(true);
    await action();
    setBusy(false);
  };

  return (
    <PersonRow
      person={member}
      isMe={isMe}
      secondary={member.accepted ? undefined : t("sharing.invited")}
    >
      {canManage ? (
        <>
          <RoleSelect
            value={member.role}
            label={t("sharing.role.label", { name })}
            disabled={busy}
            onChange={(role) =>
              act(() => setShareRole(note.id, member.id, role))
            }
          />
          <Tooltip
            label={t(member.accepted ? "sharing.remove" : "sharing.withdraw", {
              name,
            })}
          >
            <button
              type="button"
              class="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-60 cursor-pointer"
              disabled={busy}
              aria-label={t(
                member.accepted ? "sharing.remove" : "sharing.withdraw",
                { name },
              )}
              onClick={() => act(() => removeShare(note.id, member.id))}
            >
              <X class="w-4 h-4" />
            </button>
          </Tooltip>
        </>
      ) : (
        <span class="text-sm text-neutral-500 dark:text-neutral-400">
          {t(
            member.role === "edit" ? "sharing.role.edit" : "sharing.role.view",
          )}
        </span>
      )}
    </PersonRow>
  );
}

/**
 * Find someone and invite them. Where the server searches its accounts the
 * matches come as the owner types; where it only takes a whole username or
 * address, they come when the owner asks.
 */
function AddPerson({
  note,
  memberIds,
}: {
  note: Note;
  memberIds: Set<string>;
}) {
  const mode = userLookupMode.value;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<ShareRole>("edit");
  // Null until something has been looked up, so "nobody matched" is never
  // said about a query nobody has sent.
  const [results, setResults] = useState<DirectoryUser[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (mode !== "search") return;
    const q = query.trim();
    if (q.length === 0) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const found = await findUsers(q);
      if (!cancelled && found !== null) setResults(found);
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, mode]);

  const lookUp = async (event: Event) => {
    event.preventDefault();
    if (mode !== "exact" || query.trim().length === 0 || busy) return;
    setBusy(true);
    const found = await findUsers(query);
    setBusy(false);
    if (found !== null) setResults(found);
  };

  const invite = async (user: DirectoryUser) => {
    setBusy(true);
    const shared = await shareNote(note.id, user.id, role);
    setBusy(false);
    if (shared) {
      setQuery("");
      setResults(null);
    }
  };

  return (
    <form onSubmit={lookUp} class="flex flex-col gap-2">
      <label
        for="share-dialog-query"
        class="text-sm font-medium text-neutral-700 dark:text-neutral-200"
      >
        {t("sharing.add.label")}
      </label>
      <div class="flex flex-wrap items-center gap-2">
        <input
          id="share-dialog-query"
          type={mode === "search" ? "search" : "text"}
          autoComplete="off"
          // biome-ignore lint/a11y/noAutofocus: the dialog was opened to share
          autoFocus
          maxLength={254}
          placeholder={t(
            mode === "search"
              ? "sharing.add.searchPlaceholder"
              : "sharing.add.exactPlaceholder",
          )}
          value={query}
          onInput={(e) => {
            setQuery((e.currentTarget as HTMLInputElement).value);
            if (mode === "exact") setResults(null);
          }}
          class={`${inputClass} flex-1 basis-48`}
        />
        <RoleSelect
          value={role}
          onChange={setRole}
          label={t("sharing.role.newLabel")}
        />
        {mode === "exact" && (
          <button
            type="submit"
            class={secondaryButtonClass}
            disabled={busy || query.trim().length === 0}
          >
            {t("sharing.add.find")}
          </button>
        )}
      </div>

      {results !== null && results.length === 0 && (
        <p class="text-sm text-neutral-500 dark:text-neutral-400" role="status">
          {t(
            mode === "search" ? "sharing.add.noMatches" : "sharing.add.noExact",
          )}
        </p>
      )}

      {results !== null && results.length > 0 && (
        <ul class="flex flex-col rounded-lg border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700">
          {results.map((user) => {
            const name = user.displayName || user.username;
            const already = memberIds.has(user.id);
            const details = [
              name !== user.username ? user.username : null,
              user.email ?? null,
            ].filter((part): part is string => part !== null);
            return (
              <li key={user.id} class="flex items-center gap-3 px-3 py-2">
                <Avatar
                  name={name}
                  color={user.avatarColor}
                  class="w-7 h-7 text-xs"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium truncate">{name}</p>
                  {details.length > 0 && (
                    <p class="text-xs text-neutral-500 dark:text-neutral-400 truncate">
                      {details.join(" · ")}
                    </p>
                  )}
                </div>
                {already ? (
                  <span class="text-xs text-neutral-500 dark:text-neutral-400 shrink-0">
                    {t("sharing.add.already")}
                  </span>
                ) : (
                  <button
                    type="button"
                    class={`${primaryButtonClass} shrink-0`}
                    disabled={busy}
                    onClick={() => invite(user)}
                    aria-label={t("sharing.add.inviteNamed", { name })}
                  >
                    <UserPlus class="w-4 h-4" />
                    {t("sharing.add.invite")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
