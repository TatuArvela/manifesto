import { type Note, roleOf } from "@manifesto/shared";
import { formatList, t } from "../i18n/index.js";
import { currentUser } from "../state/auth.js";
import { Avatar } from "./Avatar.js";
import { Tooltip } from "./Tooltip.js";

/** How many faces a card shows before the rest become a count. */
const SHOWN = 3;

/**
 * The other people on a shared note, as a small stack of avatars on its card:
 * whoever shared it with you, or whoever you shared it with. People still
 * deciding on an invitation are shown faded, and only to the owner, who is the
 * only one told about them.
 */
export function SharedAvatars({ note }: { note: Note }) {
  const sharing = note.sharing;
  const me = currentUser.value?.id;
  if (!sharing) return null;

  const others = [
    { person: sharing.owner, accepted: true },
    ...sharing.members.map((member) => ({
      person: member,
      accepted: member.accepted,
    })),
  ].filter(({ person }) => person.id !== me);
  if (others.length === 0) return null;

  const names = (list: typeof others) =>
    formatList(list.map(({ person }) => person.displayName || person.username));
  const accepted = others.filter((o) => o.accepted);
  const pending = others.filter((o) => !o.accepted);
  const label =
    roleOf(note) === "owner"
      ? [
          accepted.length > 0
            ? t("sharing.card.sharedWith", { names: names(accepted) })
            : null,
          pending.length > 0
            ? t("sharing.card.waiting", { names: names(pending) })
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(" ")
      : t("sharing.card.sharedBy", {
          name: sharing.owner.displayName || sharing.owner.username,
        });
  const shown = others.slice(0, SHOWN);

  return (
    <Tooltip label={label}>
      <span
        role="img"
        aria-label={label}
        class="inline-flex items-center -space-x-1.5"
      >
        {shown.map(({ person, accepted: joined }) => (
          <span
            key={person.id}
            class={`rounded-full ring-2 ring-white dark:ring-neutral-800 ${joined ? "" : "opacity-50"}`}
          >
            <Avatar
              name={person.displayName || person.username}
              color={person.avatarColor}
              class="w-5 h-5 text-[10px]"
            />
          </span>
        ))}
        {others.length > SHOWN && (
          <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold bg-neutral-300 dark:bg-neutral-600 text-neutral-700 dark:text-neutral-100 ring-2 ring-white dark:ring-neutral-800">
            +{others.length - SHOWN}
          </span>
        )}
      </span>
    </Tooltip>
  );
}
