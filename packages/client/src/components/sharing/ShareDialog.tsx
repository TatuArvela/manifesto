import { type Note, roleOf, type ShareUser } from "@manifesto/shared";
import { LogOut } from "lucide-preact";
import { createPortal } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Backdrop } from "#/components/Backdrop.tsx";
import { buttonClass } from "#/components/buttonClasses.ts";
import { useEscapeStack } from "#/hooks/useEscapeStack.ts";
import { useFocusTrap } from "#/hooks/useFocusTrap.ts";
import { t } from "#/i18n/index.ts";
import { currentUser } from "#/state/account/auth.ts";
import { notes } from "#/state/notesStore.ts";
import { serverFeature } from "#/state/serverFeatures.ts";
import { leaveNote, shareDialog } from "#/state/sharing.ts";
import { AddPerson } from "./AddPerson.tsx";
import { MemberRow, PersonRow } from "./ShareMembers.tsx";
import { TeamShares } from "./TeamShares.tsx";

/**
 * The one share dialog, mounted by `App`, and opened when `shareDialog` is set.
 * A note that disappears while it is open (its owner removed this user from it)
 * closes it. It does not stay open about nothing.
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

/**
 * Who has a note. Its owner invites people, sets what each can do, and removes
 * them. All other persons see who is there, and can leave.
 */
function ShareDialog({ note, onClose }: { note: Note; onClose: () => void }) {
  const me = currentUser.value;
  const role = roleOf(note);
  const isOwner = role === "owner";
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showKeys, setShowKeys] = useState(false);

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
      <Backdrop onDismiss={onClose} class="layer-nested-backdrop" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-dialog-title"
        class="fixed inset-0 layer-nested flex items-center justify-center p-4 pointer-events-none animate-scale-in"
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

          {isOwner && serverFeature("sharing") && (
            <AddPerson
              note={note}
              memberIds={new Set(members.map((m) => m.id))}
            />
          )}

          {isOwner && <TeamShares note={note} />}

          <ul class="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-700">
            {owner && (
              <PersonRow
                person={owner}
                isMe={owner.id === me?.id}
                showKey={showKeys}
              >
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
                showKey={showKeys}
              />
            ))}
          </ul>

          {members.length > 0 && (
            <div class="flex flex-col gap-1.5">
              <button
                type="button"
                class="self-start text-sm underline text-neutral-600 dark:text-neutral-300 cursor-pointer"
                aria-expanded={showKeys}
                onClick={() => setShowKeys((shown) => !shown)}
              >
                {t(showKeys ? "sharing.keys.hide" : "sharing.keys.show")}
              </button>
              {showKeys && (
                <p class="text-xs text-neutral-500 dark:text-neutral-400">
                  {t("sharing.keys.explain")}
                </p>
              )}
            </div>
          )}

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
                    class={buttonClass("danger", "sm")}
                    disabled={busy}
                    onClick={leave}
                  >
                    {t("sharing.leave")}
                  </button>
                  <button
                    type="button"
                    class={buttonClass("secondary", "sm")}
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
                class={`${buttonClass("secondary", "sm")} self-start`}
                onClick={() => setLeaving(true)}
              >
                <LogOut class="w-4 h-4" />
                {t("sharing.leave")}
              </button>
            ))}

          <div class="flex justify-end">
            <button
              type="button"
              class={buttonClass("primary", "sm")}
              onClick={onClose}
            >
              {t("sharing.done")}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
