import { afterEach, describe, expect, it } from "vitest";
import { standInFor } from "./morphStandIn.ts";

let wrapper: HTMLElement | null = null;

/** A card in its `.group` wrapper, as `NoteCard` renders it. */
function makeCard(): HTMLElement {
  wrapper = document.createElement("div");
  wrapper.className = "group";
  const card = document.createElement("article");
  card.dataset.noteCard = "";
  const open = document.createElement("button");
  open.type = "button";
  open.dataset.cardOpen = "";
  const pin = document.createElement("button");
  pin.type = "button";
  pin.style.setProperty("anchor-name", "--tt-1");
  card.append(open, pin);
  wrapper.append(card);
  document.body.append(wrapper);
  return card;
}

afterEach(() => {
  wrapper?.remove();
  wrapper = null;
});

describe("the copy of a card in the window of a morph", () => {
  // Code that finds a card (`utils/cardFocus.ts`) found the copy too, and a
  // popover anchored to a name went onto the copy, later in the page.
  it("has none of the marks by which other code finds the card", () => {
    const { element, face } = standInFor(makeCard());
    for (const copy of [element, face]) {
      expect(copy.hasAttribute("data-note-card")).toBe(false);
      expect(copy.querySelector("[data-card-open]")).toBeNull();
      for (const el of copy.querySelectorAll<HTMLElement>("*")) {
        expect(el.style.getPropertyValue("anchor-name")).toBe("");
      }
    }
  });
});
