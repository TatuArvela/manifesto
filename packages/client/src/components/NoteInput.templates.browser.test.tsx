import { NoteColor } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { activeView, notes, templates } from "../state/index.js";
import { createNoteOrFail } from "../test/testSupport.js";
import { NoteInput } from "./NoteInput.js";

let host: HTMLDivElement;

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const chips = () => [
  ...(dialog()?.querySelectorAll<HTMLButtonElement>(
    `[aria-label="${t("templates.startFrom")}"] button`,
  ) ?? []),
];

async function openComposer() {
  (host.querySelector(".note-stack") as HTMLElement).click();
  await vi.waitFor(() =>
    expect(dialog()?.querySelector(".ProseMirror")).toBeTruthy(),
  );
}

beforeEach(() => {
  localStorage.clear();
  notes.value = [];
  activeView.value = "active";
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  localStorage.clear();
  notes.value = [];
});

describe("templates", () => {
  it("are the notes tagged template or under it, by name, trash left out", async () => {
    await createNoteOrFail({ title: "Weekly review", tags: ["template"] });
    await createNoteOrFail({
      title: "",
      content: "\n# Agenda\n- [ ] one",
      tags: ["template/meeting", "work"],
      archived: true,
    });
    await createNoteOrFail({
      title: "Gone",
      tags: ["template"],
      trashed: true,
    });
    await createNoteOrFail({ title: "Not one", tags: ["templates", "work"] });

    expect(templates.value.map((note) => note.title || note.content)).toEqual([
      "\n# Agenda\n- [ ] one",
      "Weekly review",
    ]);
  });
});

describe("NoteInput templates", () => {
  it("offers nothing when no note is a template", async () => {
    await createNoteOrFail({ title: "Plain", tags: ["work"] });
    render(<NoteInput />, host);
    await openComposer();
    expect(chips()).toHaveLength(0);
  });

  it("starts the draft from a template and saves it as an ordinary note", async () => {
    await createNoteOrFail({
      title: "Meeting",
      content: "- [ ] Agenda\n- [ ] Actions",
      color: NoteColor.Blue,
      tags: ["template/meeting", "work"],
    });
    render(<NoteInput />, host);
    await openComposer();
    expect(chips().map((chip) => chip.textContent)).toEqual(["Meeting"]);

    chips()[0]?.click();

    await vi.waitFor(() => {
      expect(dialog()?.querySelector(".ProseMirror")?.textContent).toContain(
        "Agenda",
      );
      expect(
        dialog()?.querySelector<HTMLInputElement>(
          `input[placeholder="${t("editor.titlePlaceholder")}"]`,
        )?.value,
      ).toBe("Meeting");
    });
    // Offered to an empty draft only.
    expect(chips()).toHaveLength(0);

    dialog()
      ?.querySelector<HTMLElement>(`button[aria-label="${t("editor.done")}"]`)
      ?.click();
    await vi.waitFor(() => expect(notes.value).toHaveLength(2));
    const made = notes.value.find(
      (note) => !note.tags.includes("template/meeting"),
    );
    expect(made).toMatchObject({
      title: "Meeting",
      content: "- [ ] Agenda\n- [ ] Actions",
      color: NoteColor.Blue,
      tags: ["work"],
    });
    // The template itself is as it was.
    expect(templates.value).toHaveLength(1);
  });
});
