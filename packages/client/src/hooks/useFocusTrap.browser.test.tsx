import type { ComponentChildren } from "preact";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { holdFocus, useFocusTrap } from "./useFocusTrap.ts";

/**
 * Real Tab presses through the browser, because the full behavior that the test
 * checks is the own sequential navigation of the browser. A synthetic `keydown`
 * moves focus nowhere. Thus, a trap could be fully missing, and each assertion
 * would still pass.
 */

let host: HTMLDivElement;

function Trapped({
  active = true,
  children,
}: {
  active?: boolean;
  children?: ComponentChildren;
}) {
  const ref = useFocusTrap<HTMLDivElement>(active);
  return (
    <div ref={ref} data-testid="modal">
      {children}
    </div>
  );
}

/** A page with a control before and after the modal, as a real page has. */
function Page({ active = true }: { active?: boolean }) {
  return (
    <>
      <button type="button" id="before">
        before
      </button>
      <Trapped active={active}>
        <button type="button" id="first">
          first
        </button>
        <button type="button" id="last">
          last
        </button>
      </Trapped>
      <button type="button" id="after">
        after
      </button>
    </>
  );
}

const focusedId = () => document.activeElement?.id ?? null;
const tab = () => userEvent.keyboard("{Tab}");
const shiftTab = () => userEvent.keyboard("{Shift>}{Tab}{/Shift}");

/**
 * Puts focus on a known control with a click. A real key press goes to the
 * *page*, and test files share one page. Thus, without the focus here first, a
 * Tab for this document can go into the frame of a different file.
 */
async function focusOn(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`no #${id}`);
  await userEvent.click(el);
  expect(focusedId()).toBe(id);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("useFocusTrap", () => {
  it("moves focus into the modal when nothing there has it", () => {
    render(<Page />, host);
    expect(focusedId()).toBe("first");
  });

  it("leaves focus where it is if the modal already has it", () => {
    // The note editor focuses its own content when it mounts. If the trap took
    // that away, the caret would be in the title field of each note that opens.
    function SelfFocusing() {
      return (
        <Trapped>
          <button type="button" id="first">
            first
          </button>
          <button type="button" id="chosen" ref={(el) => el?.focus()}>
            chosen
          </button>
        </Trapped>
      );
    }
    render(<SelfFocusing />, host);
    expect(focusedId()).toBe("chosen");
  });

  it("wraps forward from the last stop instead of leaving the modal", async () => {
    render(<Page />, host);
    expect(focusedId()).toBe("first");
    await focusOn("last");

    // Without the trap, this is `after`, and Tab goes on through the grid
    // behind the modal, where the cards can get focus and still open notes.
    await tab();
    expect(focusedId()).toBe("first");
  });

  it("wraps backward from the first stop", async () => {
    render(<Page />, host);
    await focusOn("first");

    await shiftTab();
    expect(focusedId()).toBe("last");
  });

  it("lets Tab move normally between stops inside the modal", async () => {
    // Only the two ends are intercepted. Thus, Tab keeps its meaning in all
    // other places. Inside ProseMirror, it still indents a list item.
    render(
      <Trapped>
        <button type="button" id="a">
          a
        </button>
        <button type="button" id="b">
          b
        </button>
        <button type="button" id="c">
          c
        </button>
      </Trapped>,
      host,
    );
    await focusOn("a");

    await tab();
    expect(focusedId()).toBe("b");
    await tab();
    expect(focusedId()).toBe("c");
  });

  it("reaches a popover portalled out of the modal", async () => {
    // `CardPopover` renders into `document.body`. Thus, a reminder picker
    // opened from inside the editor is not a descendant of the trapped
    // container. If the trap applied only to the container, nobody could reach
    // the picker.
    const popover = document.createElement("div");
    popover.className = "card-popover";
    popover.innerHTML = '<button type="button" id="in-popover">picker</button>';
    document.body.appendChild(popover);

    render(
      <Trapped>
        <button type="button" id="only">
          only
        </button>
      </Trapped>,
      host,
    );
    await focusOn("only");

    await tab();
    expect(focusedId()).toBe("in-popover");

    popover.remove();
  });

  it("gives focus back to whatever opened it", async () => {
    render(<Page active={false} />, host);
    document.getElementById("before")?.focus();
    expect(focusedId()).toBe("before");

    render(<Page active={true} />, host);
    expect(focusedId()).toBe("first");

    render(<Page active={false} />, host);
    expect(focusedId()).toBe("before");
  });

  it("leaves a stand-in holding focus, and returns focus past it", () => {
    // NoteInput focuses a hidden input inside the tap, so that iOS opens the
    // keyboard. When focus moved off it onto the first button, the keyboard
    // closed before the editor could take it. When focus went back to it on
    // close, the keyboard opened over the page.
    function WithStandIn({ active }: { active: boolean }) {
      return (
        <>
          <input id="stand-in" tabIndex={-1} />
          <Page active={active} />
        </>
      );
    }
    render(<WithStandIn active={false} />, host);
    document.getElementById("before")?.focus();
    holdFocus(document.getElementById("stand-in"));
    expect(focusedId()).toBe("stand-in");

    render(<WithStandIn active={true} />, host);
    expect(focusedId()).toBe("stand-in");

    render(<WithStandIn active={false} />, host);
    expect(focusedId()).toBe("before");
  });

  it("does not chase an opener that has left the page", () => {
    // When you archive a note from its editor, the card that opened it goes.
    render(<Page active={false} />, host);
    const opener = document.getElementById("before");
    opener?.focus();

    render(<Page active={true} />, host);
    opener?.remove();

    expect(() => render(<Page active={false} />, host)).not.toThrow();
  });
});
