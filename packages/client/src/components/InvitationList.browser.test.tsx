import { NoteColor, NoteFont, type ShareInvitation } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { noteColorMap } from "../colors.js";
import { invitations } from "../state/sharing.js";
import { InvitationList } from "./InvitationList.js";

const invitation: ShareInvitation = {
  noteId: "n1",
  role: "view",
  owner: {
    id: "u-olivia",
    username: "olivia",
    displayName: "Olivia",
    avatarColor: "#ef4444",
  },
  title: "Groceries",
  content: "**Buy** these:\n\n- [ ] Milk\n- [x] Bread",
  color: NoteColor.Green,
  font: NoteFont.Serif,
  invitedAt: "2026-04-01T00:00:00.000Z",
};

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  invitations.value = [];
});

describe("an invitation", () => {
  it("shows the note as its card would, not its Markdown", () => {
    invitations.value = [invitation];
    render(<InvitationList />, host);

    const preview = host.querySelector("article");
    if (!preview) throw new Error("no invitation rendered");
    expect(preview.textContent).not.toContain("**");
    expect(preview.textContent).not.toContain("- [ ]");
    expect(preview.querySelector("strong")?.textContent).toBe("Buy");
    const boxes = [...preview.querySelectorAll<HTMLInputElement>("input")];
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([
      [false, true],
      [true, true],
    ]);
    expect(preview.innerHTML).toContain(
      noteColorMap[NoteColor.Green].bg.split(" ")[0],
    );
  });
});
