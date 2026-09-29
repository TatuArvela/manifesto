import type { AdminTeam, AdminUser } from "@manifesto/shared";
import { Trash2, Users } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { plural, t } from "../../i18n/index.js";
import { adminUsers } from "../../state/admin.js";
import { askConfirmation } from "../../state/confirm.js";
import {
  createTeam,
  deleteTeam,
  listAdminTeams,
  type TeamWriteResult,
  updateTeam,
} from "../../state/teams.js";
import { showError } from "../../state/ui.js";

const primaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer";
const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-60 cursor-pointer";
const fieldClass =
  "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

function reportWrite(result: TeamWriteResult): AdminTeam | null {
  if (result.kind === "ok") return result.team;
  showError(
    t(
      result.kind === "name-taken"
        ? "admin.teams.nameTaken"
        : "admin.teams.saveFailed",
    ),
  );
  return null;
}

/**
 * The admin's teams: made and filled here, or mirrored from the identity
 * provider's groups, whose members are the provider's and shown read-only.
 * Sharing a note with a team invites its members; a change of members here
 * invites the newcomers and takes the notes from those who left.
 */
export function AdminTeams() {
  const [teams, setTeams] = useState<AdminTeam[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void listAdminTeams().then((listed) => {
      if (listed) setTeams(listed);
      else setFailed(true);
    });
  }, []);

  const replace = (team: AdminTeam) =>
    setTeams((held) => held?.map((t) => (t.id === team.id ? team : t)) ?? null);

  const create = async (e: Event) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const team = reportWrite(await createTeam(trimmed, []));
    setBusy(false);
    if (!team) return;
    setName("");
    setTeams((held) =>
      [...(held ?? []), team].sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  const remove = async (team: AdminTeam) => {
    const confirmed = await askConfirmation({
      title: t("admin.teams.delete.title", { name: team.name }),
      body: t("admin.teams.delete.body"),
      confirmLabel: t("admin.teams.delete"),
    });
    if (!confirmed) return;
    if (await deleteTeam(team.id)) {
      setTeams((held) => held?.filter((t) => t.id !== team.id) ?? null);
    } else {
      showError(t("admin.teams.saveFailed"));
    }
  };

  return (
    <div class="flex flex-col gap-4">
      <p class="text-sm text-neutral-600 dark:text-neutral-300">
        {t("admin.teams.explain")}
      </p>
      <form
        onSubmit={create}
        class="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-4 flex flex-wrap items-end gap-2"
      >
        <label class="flex-1 min-w-48">
          <span class="block text-sm font-medium text-neutral-700 dark:text-neutral-200 mb-1">
            {t("admin.teams.name")}
          </span>
          <input
            type="text"
            maxLength={100}
            value={name}
            onInput={(e) =>
              setName((e.currentTarget as HTMLInputElement).value)
            }
            class={fieldClass}
          />
        </label>
        <button
          type="submit"
          class={primaryButtonClass}
          disabled={busy || name.trim().length === 0}
        >
          <Users class="w-4 h-4" />
          {t("admin.teams.create")}
        </button>
      </form>

      {failed ? (
        <p role="alert" class="text-sm text-red-600 dark:text-red-400">
          {t("admin.teams.loadFailed")}
        </p>
      ) : teams && teams.length === 0 ? (
        <p class="text-sm text-neutral-500 dark:text-neutral-400">
          {t("admin.teams.none")}
        </p>
      ) : (
        <ul class="rounded-xl border border-neutral-200 dark:border-neutral-700 divide-y divide-neutral-200 dark:divide-neutral-700 bg-white dark:bg-neutral-800">
          {teams?.map((team) => (
            <TeamRow
              key={team.id}
              team={team}
              users={adminUsers.value ?? []}
              onChanged={replace}
              onDelete={() => remove(team)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamRow({
  team,
  users,
  onChanged,
  onDelete,
}: {
  team: AdminTeam;
  users: AdminUser[];
  onChanged: (team: AdminTeam) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(team.members.map((m) => m.id)),
  );
  const [busy, setBusy] = useState(false);
  const fromProvider = team.source === "oidc";

  const save = async () => {
    setBusy(true);
    const saved = reportWrite(
      await updateTeam(team.id, { memberIds: [...selected] }),
    );
    setBusy(false);
    if (!saved) return;
    onChanged(saved);
    setEditing(false);
  };

  return (
    <li class="p-3 flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium truncate">{team.name}</p>
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            {plural("admin.teams.members", team.memberCount)}
            {fromProvider && ` · ${t("admin.teams.fromProvider")}`}
          </p>
        </div>
        {!fromProvider && !editing && (
          <button
            type="button"
            class={secondaryButtonClass}
            onClick={() => setEditing(true)}
          >
            {t("admin.teams.editMembers")}
          </button>
        )}
        <button
          type="button"
          class="p-1.5 rounded-lg text-red-600 dark:text-red-400 hover:bg-neutral-100 dark:hover:bg-neutral-700 cursor-pointer"
          aria-label={t("admin.teams.delete")}
          title={t("admin.teams.delete")}
          onClick={onDelete}
        >
          <Trash2 class="w-4 h-4" />
        </button>
      </div>
      {editing ? (
        <div class="flex flex-col gap-2">
          <ul class="max-h-60 overflow-y-auto flex flex-col gap-1">
            {users.map((user) => (
              <li key={user.id}>
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if ((e.currentTarget as HTMLInputElement).checked) {
                        next.add(user.id);
                      } else {
                        next.delete(user.id);
                      }
                      setSelected(next);
                    }}
                  />
                  {user.displayName || user.username}
                  <span class="text-neutral-500">@{user.username}</span>
                </label>
              </li>
            ))}
          </ul>
          <div class="flex gap-2">
            <button
              type="button"
              class={primaryButtonClass}
              disabled={busy}
              onClick={save}
            >
              {t("admin.teams.save")}
            </button>
            <button
              type="button"
              class={secondaryButtonClass}
              onClick={() => {
                setSelected(new Set(team.members.map((m) => m.id)));
                setEditing(false);
              }}
            >
              {t("admin.cancel")}
            </button>
          </div>
        </div>
      ) : (
        team.members.length > 0 && (
          <p class="text-xs text-neutral-600 dark:text-neutral-300">
            {team.members.map((m) => m.displayName).join(", ")}
          </p>
        )
      )}
    </li>
  );
}
