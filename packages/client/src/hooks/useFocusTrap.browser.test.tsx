import type { ComponentChildren } from "preact";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { useFocusTrap } from "./useFocusTrap.js";

/**
 * Real Tab presses through the browser, because the whole behaviour under test
 * is the browser's own sequential navigation — a synthesised `keydown` moves
 * focus nowhere, so a trap could be missing entirely and every assertion would
 * still pass.
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

/** A page with a control before and after the modal, as a real one has. */
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
 * Puts focus on a known control by clicking it. A real key press goes to the
 * *page*, and test files share one — so without first taking focus here, a Tab
 * meant for this document can land in another file's frame.
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
    // The note editor focuses its own content as it mounts; taking that away
    // would put the caret in the title field of every note opened.
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

    // Without the trap this is `after`, and Tab walks on through the grid
    // behind the modal — where the cards are focusable and still open notes.
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
    // Only the two ends are intercepted, so Tab keeps its meaning everywhere
    // else — inside ProseMirror it still indents a list item.
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
    // `CardPopover` renders into `document.body`, so a reminder picker opened
    // from inside the editor is not a descendant of the trapped container.
    // Scoping the trap to the container alone would make it unreachable.
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

  it("does not chase an opener that has left the page", () => {
    // Archiving a note from its editor removes the card that opened it.
    render(<Page active={false} />, host);
    const opener = document.getElementById("before");
    opener?.focus();

    render(<Page active={true} />, host);
    opener?.remove();

    expect(() => render(<Page active={false} />, host)).not.toThrow();
  });
});
