import type { Note, ShareRole, Team, TeamShare } from "@manifesto/shared";
import { Users, X } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { buttonClass } from "#/components/buttonClasses.ts";
import { Tooltip } from "#/components/Tooltip.tsx";
import { t } from "#/i18n/index.ts";
import { serverFeature } from "#/state/serverFeatures.ts";
import {
  listMyTeams,
  listTeamShares,
  removeTeamShare,
  setTeamShareRole,
  shareWithTeam,
} from "#/state/teams.ts";
import { showError } from "#/state/ui.ts";
import { RoleSelect, selectClass } from "./ShareMembers.tsx";

/**
 * The teams a note is shared with, for its owner: offered only their own
 * teams, and shown nothing at all when they are in none. Sharing with a team
 * invites each member, and later members as they join. With teams off on
 * the server, only the shares already made, to take them off.
 */
export function TeamShares({ note }: { note: Note }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [shares, setShares] = useState<TeamShare[]>([]);
  const [picked, setPicked] = useState("");
  const [role, setRole] = useState<ShareRole>("edit");
  const [busy, setBusy] = useState(false);
  const teamsOn = serverFeature("teams");

  useEffect(() => {
    let cancelled = false;
    const mine = teamsOn ? listMyTeams() : Promise.resolve([]);
    void Promise.all([mine, listTeamShares(note.id)]).then(
      ([mine, current]) => {
        if (cancelled) return;
        setTeams(mine ?? []);
        setShares(current ?? []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [note.id, teamsOn]);

  const offered = teams.filter((team) =>
    shares.every((share) => share.teamId !== team.id),
  );
  // An owner who has left a team still sees the note's share with it, or
  // nothing would let them end it.
  if (teams.length === 0 && shares.length === 0) return null;

  const run = async (action: () => Promise<TeamShare[] | null>) => {
    setBusy(true);
    const next = await action();
    setBusy(false);
    if (next) setShares(next);
    else showError(t("sharing.teams.failed"));
  };

  return (
    <div class="flex flex-col gap-2">
      <h3 class="text-sm font-medium">{t("sharing.teams.title")}</h3>
      {offered.length > 0 && (
        <div class="flex gap-2">
          <select
            class={`${selectClass} flex-1 min-w-0`}
            value={picked}
            aria-label={t("sharing.teams.pick")}
            onChange={(e) =>
              setPicked((e.currentTarget as HTMLSelectElement).value)
            }
          >
            <option value="">{t("sharing.teams.pick")}</option>
            {offered.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <RoleSelect
            value={role}
            onChange={setRole}
            label={t("sharing.teams.role")}
          />
          <button
            type="button"
            class={buttonClass("primary", "sm")}
            disabled={busy || !picked}
            onClick={() =>
              run(async () => {
                const next = await shareWithTeam(note.id, picked, role);
                if (next) setPicked("");
                return next;
              })
            }
          >
            {t("sharing.teams.add")}
          </button>
        </div>
      )}
      {shares.length > 0 && (
        <ul class="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-700">
          {shares.map((share) => (
            <li key={share.teamId} class="flex items-center gap-3 py-2">
              <Users class="w-4 h-4 text-neutral-500 shrink-0" />
              <span class="flex-1 min-w-0 text-sm font-medium truncate">
                {share.name}
              </span>
              <RoleSelect
                value={share.role}
                label={t("sharing.role.label", { name: share.name })}
                disabled={busy || !teamsOn}
                onChange={(next) =>
                  run(() => setTeamShareRole(note.id, share.teamId, next))
                }
              />
              <Tooltip label={t("sharing.teams.remove", { team: share.name })}>
                <button
                  type="button"
                  class="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700 disabled:opacity-60 cursor-pointer"
                  disabled={busy}
                  aria-label={t("sharing.teams.remove", { team: share.name })}
                  onClick={() =>
                    run(async () =>
                      (await removeTeamShare(note.id, share.teamId))
                        ? shares.filter((s) => s.teamId !== share.teamId)
                        : null,
                    )
                  }
                >
                  <X class="w-4 h-4" />
                </button>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
