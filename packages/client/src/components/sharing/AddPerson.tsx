import type { DirectoryUser, Note, ShareRole } from "@manifesto/shared";
import { UserPlus } from "lucide-preact";
import { useEffect, useState } from "preact/hooks";
import { Avatar } from "#/components/Avatar.tsx";
import { buttonClass } from "#/components/buttonClasses.ts";
import { t } from "#/i18n/index.ts";
import { userLookupMode } from "#/state/account/auth.ts";
import { findUsers, shareNote } from "#/state/sharing.ts";
import { RoleSelect } from "./ShareMembers.tsx";

const inputClass =
  "w-full min-w-0 rounded-lg border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-3 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-blue-500";

/** How long the owner must stop typing before a search goes out. */
const SEARCH_DELAY_MS = 250;

/**
 * Find a person and invite them. Where the server searches its accounts, the
 * matches come while the owner types. Where it accepts only a full username or
 * address, they come when the owner asks.
 */
export function AddPerson({
  note,
  memberIds,
}: {
  note: Note;
  memberIds: Set<string>;
}) {
  const mode = userLookupMode.value;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<ShareRole>("edit");
  // Null until something was looked up. Thus, the app never says "nobody
  // matched" about a query that nobody sent.
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
          // Spread, not `type={a ? b : c}`. The input types are a union with
          // `type` as the key, and a union of two of them matches no single
          // member.
          {...(mode === "search"
            ? ({ type: "search" } as const)
            : ({ type: "text" } as const))}
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
            class={buttonClass("secondary", "sm")}
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
                    class={`${buttonClass("primary", "sm")} shrink-0`}
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
