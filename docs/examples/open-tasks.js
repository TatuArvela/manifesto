// @title Open tasks
// @reads todo
//
// Example auto-note plugin that reads other notes: each checklist item that is
// not ticked, from the notes tagged `todo`, collected on one card.
//
// Paste this into Settings → Auto-notes → Paste code. The line above asks to
// read your notes tagged `todo`. Nothing is read until you push Allow on the
// row of the plugin, and Stop removes the permission. Name several tags with
// commas, or on several `// @reads` lines.
//
// A plugin that reads gets two more values in `ctx`:
//   - notes:  the notes that have one of the permitted tags, most recently
//             changed first, each as { id, title, content, tags, color,
//             pinned, archived, createdAt, updatedAt }. Frozen: you cannot
//             write to them. Trashed notes are not included.
//   - reads:  the tags that it reads now ([] until permitted).
//
// It runs again a moment after one of those notes changes. Thus, the card
// stays current with the lists that it collects. Its cards are drawn without
// images.

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
