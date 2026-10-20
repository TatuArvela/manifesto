import type { Note, NoteMember, ShareRole, ShareUser } from "@manifesto/shared";
import { X } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { Avatar } from "#/components/Avatar.tsx";
import { Tooltip } from "#/components/Tooltip.tsx";
import { t } from "#/i18n/index.ts";
import { serverFeature } from "#/state/serverFeatures.ts";
import {
  changedKeys,
  keyStatusOf,
  removeShare,
  setShareRole,
  trustKeys,
} from "#/state/sharing.ts";

export const selectClass =
  "rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-60";

export function RoleSelect({
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
 * The key of a person: its fingerprint while the dialog compares keys, and
 * always the warning when it is not the key that this account remembers for
 * them.
 */
function PersonKey({
  person,
  showing,
}: {
  person: ShareUser;
  showing: boolean;
}) {
  const [status, setStatus] = useState<
    { fingerprint: string; changed: boolean } | null | undefined
  >(undefined);
  const [busy, setBusy] = useState(false);
  // A key that this session found and could not use, because it is not the
  // remembered key. Shown whether keys are compared or not.
  const changed = changedKeys.value.has(person.id);
  const wanted = showing || changed;

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    void keyStatusOf(person.id).then((found) => {
      if (!cancelled) setStatus(found);
    });
    return () => {
      cancelled = true;
    };
    // Read again after a changed key is trusted.
  }, [person.id, wanted, changed]);

  if (!wanted || status === undefined) return null;
  const name = person.displayName || person.username;
  if (status?.changed) {
    return (
      <div role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">
        <p>{t("sharing.keys.changed", { name })}</p>
        <p class="font-mono mt-0.5">
          {t("sharing.keys.fingerprint", { fingerprint: status.fingerprint })}
        </p>
        <button
          type="button"
          class="mt-1 underline cursor-pointer disabled:opacity-60"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await trustKeys(person.id);
            setBusy(false);
          }}
        >
          {t("sharing.keys.trust")}
        </button>
      </div>
    );
  }
  if (!showing) return null;
  return (
    <p class="mt-0.5 text-xs font-mono text-neutral-500 dark:text-neutral-400">
      {status
        ? t("sharing.keys.fingerprint", { fingerprint: status.fingerprint })
        : t("sharing.keys.none")}
    </p>
  );
}

export function PersonRow({
  person,
  isMe,
  secondary,
  showKey = false,
  children,
}: {
  person: ShareUser;
  isMe: boolean;
  secondary?: string | undefined;
  showKey?: boolean | undefined;
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
        <PersonKey person={person} showing={showKey} />
      </div>
      <div class="flex items-center gap-1 shrink-0">{children}</div>
    </li>
  );
}

export function MemberRow({
  note,
  member,
  isMe,
  canManage,
  showKey,
}: {
  note: Note;
  member: NoteMember;
  isMe: boolean;
  canManage: boolean;
  showKey: boolean;
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
      showKey={showKey}
      secondary={
        [
          member.accepted ? null : t("sharing.invited"),
          member.team ? t("sharing.viaTeam", { team: member.team.name }) : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" · ") || undefined
      }
    >
      {canManage ? (
        <>
          <RoleSelect
            value={member.role}
            label={t("sharing.role.label", { name })}
            // Sharing is off on the server: people can be removed, but not
            // changed.
            disabled={busy || !serverFeature("sharing")}
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
