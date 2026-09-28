import type { ComponentChildren } from "preact";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { afterHistorySettles } from "../state/sheetHistory.js";
import { useBackToClose } from "./useBackToClose.js";

/**
 * Real history on a real page: what matters is which entry the browser ends
 * up on and which sheet hears about it, which a mocked `history` cannot show.
 * Every step waits for the `popstate` it causes, since going back is
 * asynchronous and the hook's own backs are part of what is under test.
 */

let host: HTMLDivElement;

function Sheet({
  active = true,
  onBack,
}: {
  active?: boolean;
  onBack: () => void;
}) {
  useBackToClose(active, onBack);
  return null;
}

const show = (tree: ComponentChildren) => render(tree, host);

const nextPop = () =>
  new Promise<void>((resolve) =>
    window.addEventListener("popstate", () => resolve(), { once: true }),
  );

/** Resolves once every `history.back()` of the hook's own has landed. */
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
  show(null);
  await settled();
  host.remove();
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

  it("closes only the newest of two sheets", async () => {
    const lower = vi.fn();
    const upper = vi.fn();
    // The same tree both times, so the lower sheet stays mounted throughout.
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

    // Closed and replaced in one go, as a reminder opening another note does.
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
