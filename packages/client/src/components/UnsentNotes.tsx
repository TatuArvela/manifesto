import clsx from "clsx";
import { useState } from "preact/hooks";
import { noteColorMap, noteFontFamilies } from "#/colors.js";
import { plural, t } from "#/i18n/index.js";
import { confirmDeletion } from "#/state/confirm.js";
import {
  discardUnsent,
  reopenUnsent,
  sendingNoteId,
  settledNoteIds,
  type UnsentNote,
  unsentNotes,
} from "#/state/unsentNotes.js";
import { buttonClass } from "./buttonClasses.js";
import { ContentPreview } from "./ContentPreview.js";

/**
 * The notes written here that the server has not taken yet: kept on this
 * device and sent when it can be reached. They are not on the board, since
 * they are not stored anywhere else yet; each can be taken back into the
 * composer to be changed, or discarded. A note sent in a moment is never
 * shown, only one whose first try has failed.
 */
export function UnsentNotes() {
  const settled = settledNoteIds.value;
  const list = unsentNotes.value.filter((e) => settled.has(e.id));
  if (list.length === 0) return null;
  return (
    <section
      data-marquee-ignore
      aria-labelledby="unsent-notes-heading"
      class="mt-4 w-full max-w-xl mx-auto flex flex-col gap-2"
    >
      <div role="status">
        <h2 id="unsent-notes-heading" class="text-sm font-medium">
          {plural("unsent.heading", list.length)}
        </h2>
        <p class="text-sm text-neutral-600 dark:text-neutral-300">
          {t("unsent.explanation")}
        </p>
      </div>
      {list.map((entry) => (
        <UnsentCard key={entry.id} entry={entry} />
      ))}
    </section>
  );
}

function UnsentCard({ entry }: { entry: UnsentNote }) {
  const [busy, setBusy] = useState(false);
  const { note } = entry;
  const colors = noteColorMap[note.color];
  const sending = sendingNoteId.value === entry.id;

  const act = async (action: (id: string) => Promise<boolean>) => {
    setBusy(true);
    // One that worked is gone from the list, and nothing here outlives it.
    await action(entry.id);
    setBusy(false);
  };

  return (
    <article class="flex flex-col gap-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 shadow-sm">
      <div
        class={clsx(
          colors.bg,
          colors.border,
          "note-surface border p-3 max-h-32 overflow-hidden note-content-fade",
        )}
        style={{ fontFamily: noteFontFamilies[note.font] || undefined }}
      >
        {note.title && (
          <h3 class="font-medium text-base leading-snug">{note.title}</h3>
        )}
        <ContentPreview
          note={note}
          onCheckboxToggle={() => {}}
          hasTitle={note.title !== ""}
          readOnly
          noImages
        />
        {!note.title && !note.content && (
          <p class="text-sm opacity-80">{t("unsent.untitled")}</p>
        )}
      </div>
      {entry.refused && (
        <p class="text-sm text-red-700 dark:text-red-300">
          {t("unsent.refused")}
        </p>
      )}
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class={buttonClass("secondary", "sm")}
          disabled={busy || sending}
          onClick={() => act(reopenUnsent)}
        >
          {t("unsent.edit")}
        </button>
        <button
          type="button"
          class={buttonClass("quiet", "sm")}
          disabled={busy || sending}
          onClick={async () => {
            const sure = await confirmDeletion({
              title: t("unsent.discardConfirm"),
              body: t("unsent.discardBody"),
              confirmLabel: t("unsent.discard"),
            });
            if (sure) await act(discardUnsent);
          }}
        >
          {t("unsent.discard")}
        </button>
        {sending && (
          <span class="text-sm text-neutral-600 dark:text-neutral-300">
            {t("unsent.sending")}
          </span>
        )}
      </div>
    </article>
  );
}
