// @title Open tasks
// @reads todo
//
// Example auto-note plugin that reads other notes: every unticked checklist
// item across the notes tagged `todo`, gathered on one card.
//
// Paste this into Settings → Auto-notes → Paste code. The line above asks to
// read your notes tagged `todo`; nothing is read until you press Allow on the
// plugin's row, and Stop takes it back. Name several tags with commas, or on
// several `// @reads` lines.
//
// A plugin that reads gets two more things in `ctx`:
//   - notes:  the notes carrying one of the allowed tags, most recently
//             changed first, each as { id, title, content, tags, color,
//             pinned, archived, createdAt, updatedAt }. Frozen: there is
//             nothing to write to. Trashed notes are left out.
//   - reads:  the tags it is reading right now ([] until allowed).
//
// It runs again a moment after any of those notes changes, so the card keeps
// up with the lists it gathers. Its cards are drawn without images.

const UNTICKED = /^\s*(?:[-*+] )?\[ \] (.+)$/;

function openTasks({ notes, reads, locale }) {
  const fi = locale.startsWith("fi");
  if (reads.length === 0) {
    return {
      title: fi ? "Avoimet tehtävät" : "Open tasks",
      content: fi
        ? "Salli liitännäisen lukea `todo`-tunnisteen muistiinpanot sen rivillä."
        : "Allow this plugin to read notes tagged `todo` on its row.",
      color: "gray",
    };
  }

  const sections = [];
  let count = 0;
  for (const note of notes) {
    if (note.archived) continue;
    const open = note.content
      .split("\n")
      .map((line) => UNTICKED.exec(line))
      .filter(Boolean)
      .map((match) => `- ${match[1]}`);
    if (open.length === 0) continue;
    count += open.length;
    sections.push(
      `**${note.title || (fi ? "Nimetön" : "Untitled")}**\n${open.join("\n")}`,
    );
  }

  return {
    title: fi ? `Avoimet tehtävät (${count})` : `Open tasks (${count})`,
    content:
      sections.join("\n\n") || (fi ? "Kaikki tehty." : "Nothing left to do."),
    color: count === 0 ? "green" : "yellow",
    tags: ["overview"],
  };
}

_default = openTasks;
