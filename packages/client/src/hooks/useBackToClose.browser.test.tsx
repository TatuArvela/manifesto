import type { ComponentChildren } from "preact";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterHistorySettles } from "#/state/sheetHistory.ts";
import { useBackToClose } from "./useBackToClose.ts";

/**
 * Real history on a real page. The important results are on which entry the
 * browser stops, and which sheet learns about it. A mocked `history` cannot
 * show that. Each step waits for the `popstate` that it causes, because back is
 * asynchronous, and the own backs of the hook are part of what the test checks.
 */

let host: HTMLDivElement;

function Sheet({
  active = true,
  onBack,
}: {
  active?: boolean;
  onBack: () => unknown;
}) {
  useBackToClose(active, onBack);
  return null;
}

/** A sheet that pushes its entry after its first paint, as `NoteSheet` does. */
function LateSheet({
  active = true,
  onBack,
}: {
  active?: boolean;
  onBack: () => unknown;
}) {
  useBackToClose(active, onBack, { pushAfterPaint: true });
  return null;
}

/** No frame comes, as in a tab in the background. */
const noFrames = () =>
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);

const show = (tree: ComponentChildren) => render(tree, host);

const nextPop = () =>
  new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );

/** Resolves when each own `history.back()` of the hook is complete. */
const settled = () =>
  new Promise<void>((resolve) =>
    afterHistorySettles(() => setTimeout(resolve, 0)),
  );

beforeEach(() => {
  history.replaceState({ page: "board" }, "", "/");
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(async () => {
  vi.restoreAllMocks();
  show(null);
  await settled();
  host.remove();
});

describe("a sheet that pushes after its first paint", () => {
  // A tab in the background paints no frame. The push waited for one, and
  // held each push of the router until the tab showed.
  it("pushes its entry when no frame comes", async () => {
    noFrames();
    show(<LateSheet onBack={vi.fn()} />);
    await settled();
    expect(history.state).not.toEqual({ page: "board" });
  });

  it("holds nothing when it closes before its push", () => {
    noFrames();
    show(<LateSheet onBack={vi.fn()} />);
    show(<LateSheet active={false} onBack={vi.fn()} />);
    let ran = false;
    afterHistorySettles(() => {
      ran = true;
    });
    expect(ran).toBe(true);
    expect(history.state).toEqual({ page: "board" });
  });

  // A back before the push went back from the entry of the view under the
  // sheet. The view changed, and the sheet stayed open.
  it("closes on a back before its push, and keeps the page", async () => {
    history.pushState({ page: "view" }, "", "/tags");
    noFrames();
    const onBack = vi.fn();
    show(<LateSheet onBack={onBack} />);

    // The sheet stops the back itself, and goes forward again. Thus, the
    // listeners after it hear only that forward.
    const popped = nextPop();
    history.back();
    await popped;
    expect(onBack).toHaveBeenCalledOnce();
    expect(location.pathname).toBe("/tags");
    expect(history.state).toEqual({ page: "view" });
  });
});

describe("the browser's back", () => {
  it("closes an open sheet and leaves the page where it was", async () => {
    const onBack = vi.fn();
    show(<Sheet onBack={onBack} />);
    await settled();
    expect(history.state).not.toEqual({ page: "board" });

    const popped = nextPop();
    history.back();
    await popped;
    expect(onBack).toHaveBeenCalledOnce();
    expect(history.state).toEqual({ page: "board" });
    expect(window.location.pathname).toBe("/");
  });

  it("stays the sheet's own when the sheet declines to close", async () => {
    const lower = vi.fn();
    const upper = vi.fn(() => false);
    show(
      <>
        <Sheet onBack={lower} />
        <Sheet onBack={upper} />
      </>,
    );
    await settled();
    const upperEntry = history.state;

    for (const presses of [1, 2]) {
      const popped = nextPop();
      history.back();
      await popped;
      expect(upper).toHaveBeenCalledTimes(presses);
      expect(history.state).toEqual(upperEntry);
    }
    expect(lower).not.toHaveBeenCalled();
  });

  it("closes only the newest of two sheets", async () => {
    const lower = vi.fn();
    const upper = vi.fn();
    // The same tree both times. Thus, the lower sheet stays mounted all the
    // time.
    const Stack = ({ both }: { both: boolean }) => (
      <>
        <Sheet onBack={lower} />
        {both && <Sheet onBack={upper} />}
      </>
    );
    show(<Stack both={false} />);
    await settled();
    show(<Stack both />);
    await settled();

    const popped = nextPop();
    history.back();
    await popped;
    expect(upper).toHaveBeenCalledOnce();
    expect(lower).not.toHaveBeenCalled();
  });
});

describe("a sheet closed some other way", () => {
  it("takes its own entry off again", async () => {
    const onBack = vi.fn();
    show(<Sheet onBack={onBack} />);
    await settled();

    show(<Sheet active={false} onBack={onBack} />);
    await settled();
    expect(history.state).toEqual({ page: "board" });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("lets one opened while its entry is still going get its own", async () => {
    const first = vi.fn();
    const second = vi.fn();
    show(<Sheet onBack={first} />);
    await settled();

    // Closed and replaced in one step, as a reminder that opens a different
    // note does.
    show(<Sheet active={false} onBack={first} />);
    show(<Sheet key="second" onBack={second} />);
    await settled();
    expect(history.state).not.toEqual({ page: "board" });

    const popped = nextPop();
    history.back();
    await popped;
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(history.state).toEqual({ page: "board" });
  });
});
