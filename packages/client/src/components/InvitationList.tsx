import type { ShareInvitation } from "@manifesto/shared";
import clsx from "clsx";
import { useEffect, useRef, useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "../colors.js";
import { t } from "../i18n/index.js";
import {
  acceptInvitation,
  declineInvitation,
  invitations,
} from "../state/sharing.js";
import { Avatar } from "./Avatar.js";
import { ContentPreview } from "./ContentPreview.js";

/**
 * Notes other people have offered, above the Notes view's grid. Nothing
 * reaches a user's notes until they say yes, so the offer has to be somewhere
 * they will see it without going looking.
 */
export function InvitationList() {
  // Only ever filled in connected mode, so open mode shows nothing here.
  const list = invitations.value;
  if (list.length === 0) return null;
  return (
    <section
      data-marquee-ignore
      aria-label={t("sharing.invitations.label")}
      class="mt-4 w-full max-w-xl mx-auto flex flex-col gap-2"
    >
      {list.map((invitation) => (
        <InvitationCard key={invitation.noteId} invitation={invitation} />
      ))}
    </section>
  );
}

function InvitationCard({ invitation }: { invitation: ShareInvitation }) {
  const [busy, setBusy] = useState(false);
  const name = invitation.owner.displayName || invitation.owner.username;
  const colors = noteColorMap[invitation.color];
  const previewRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);

  // Faded at the bottom only when the note is taller than the preview, as a
  // card in the grid is.
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => setClipped(el.scrollHeight > el.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [invitation.title, invitation.content]);

  const answer = async (act: (noteId: string) => Promise<boolean>) => {
    setBusy(true);
    // A card that worked is gone from the list, and nothing here outlives it.
    await act(invitation.noteId);
    setBusy(false);
  };

  return (
    <article class="flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 shadow-sm">
      <div class="flex items-center gap-2 min-w-0">
        <Avatar
          name={name}
          color={invitation.owner.avatarColor}
          class="w-6 h-6 text-[11px]"
        />
        <p class="text-sm text-neutral-600 dark:text-neutral-300 truncate">
          {t(
            invitation.role === "edit"
              ? "sharing.invitation.edit"
              : "sharing.invitation.view",
            { name },
          )}
        </p>
      </div>

      {/* The note itself, drawn as its card would be, so there is something
          to decide on. Its boxes are for looking at until it is accepted. */}
      <div
        ref={previewRef}
        class={clsx(
          colors.bg,
          colors.border,
          "note-surface border p-3 max-h-48 overflow-hidden",
          clipped && "note-content-fade",
        )}
        style={{
          fontFamily: noteFontFamilies[invitation.font] || undefined,
        }}
      >
        <h3 class="font-medium text-base leading-snug">
          {invitation.title || t("sharing.untitled")}
        </h3>
        <ContentPreview
          note={invitation}
          onCheckboxToggle={() => {}}
          hasTitle
          readOnly
        />
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 cursor-pointer"
          disabled={busy}
          onClick={() => answer(acceptInvitation)}
        >
          {t("sharing.invitation.accept")}
        </button>
        <button
          type="button"
          class="px-3 py-1.5 text-sm rounded-lg font-medium bg-neutral-100 dark:bg-neutral-700 hover:bg-neutral-200 dark:hover:bg-neutral-600 disabled:opacity-60 cursor-pointer"
          disabled={busy}
          onClick={() => answer(declineInvitation)}
        >
          {t("sharing.invitation.decline")}
        </button>
      </div>
    </article>
  );
}
