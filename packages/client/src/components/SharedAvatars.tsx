import { type Note, roleOf, type ShareUser } from "@manifesto/shared";
import { formatList, t } from "../i18n/index.js";
import { currentUser } from "../state/auth.js";
import { shareDialog } from "../state/sharing.js";
import { Avatar } from "./Avatar.js";
import { Tooltip } from "./Tooltip.js";

/** How many faces a card shows before the rest become a count. */
const SHOWN = 3;

interface Person {
  person: ShareUser;
  accepted: boolean;
}

/**
 * The other people on a shared note and a sentence naming them: whoever
 * shared it with you, or whoever you shared it with. People still deciding on
 * an invitation are only named to the owner, who is the only one told about
 * them. Null when there is nobody else to show.
 */
function sharedPeople(note: Note): { others: Person[]; label: string } | null {
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
  return { others, label };
}

/** The faces themselves, faded for anyone who has not accepted yet. */
function AvatarStack({ others }: { others: Person[] }) {
  const shown = others.slice(0, SHOWN);
  return (
    <span class="inline-flex shrink-0 items-center -space-x-1.5">
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
  );
}

/**
 * The other people on a shared note, as a small stack of avatars on its card,
 * with their names in a tooltip.
 */
export function SharedAvatars({ note }: { note: Note }) {
  const people = sharedPeople(note);
  if (!people) return null;
  return (
    <Tooltip label={people.label}>
      <span role="img" aria-label={people.label} class="inline-flex">
        <AvatarStack others={people.others} />
      </span>
    </Tooltip>
  );
}

/**
 * The same people in an open note, where there is room to name them. It opens
 * the share dialog, as the menu's "Share with people" or "People" row does.
 */
export function SharedPeople({
  note,
  label,
}: {
  note: Note;
  /** Said instead of the names, where the view has more to say. */
  label?: string;
}) {
  const people = sharedPeople(note);
  if (!people) return null;
  return (
    <button
      type="button"
      class="flex max-w-full items-center gap-2 mt-3 -ml-1 px-1 py-0.5 rounded-full text-left text-xs text-black/50 dark:text-white/50 hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
      onClick={() => {
        shareDialog.value = { noteId: note.id };
      }}
    >
      <AvatarStack others={people.others} />
      <span class="min-w-0">{label ?? people.label}</span>
    </button>
  );
}
