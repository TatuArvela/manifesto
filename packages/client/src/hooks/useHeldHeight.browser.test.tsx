import { render } from "preact";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useHeldHeight } from "./useHeldHeight.ts";

let host: HTMLDivElement;

/**
 * A wrapper with one child, as the text of the editor: a new `build` replaces
 * the child, as the remount from solo to collab does.
 */
function Probe({
  build,
  height,
  editor,
}: {
  build: string;
  height: number;
  editor: object | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  useHeldHeight([wrap], editor);
  return (
    <div ref={wrap} id="wrap">
      <div key={build} style={{ height: `${height}px` }} />
    </div>
  );
}

const wrap = () => document.getElementById("wrap") as HTMLDivElement;

/** Preact runs effects after paint. Give it one frame and one tick. */
const flush = () =>
  new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("useHeldHeight", () => {
  // The hold must come before the paint. A hold that waited for the state of
  // the editor came one render late, and a collapsed frame was painted.
  it("keeps the height from the moment that the old content goes", async () => {
    const solo = {};
    render(<Probe build="solo" height={120} editor={solo} />, host);
    await flush();

    // The state of the editor is still the old one in this render.
    render(<Probe build="collab" height={0} editor={solo} />, host);
    // The observer reports in a microtask, before the browser can paint.
    await Promise.resolve();
    expect(wrap().style.minHeight).toBe("120px");
    expect(wrap().offsetHeight).toBe(120);
  });

  it("lets go when a different editor arrives", async () => {
    const solo = {};
    render(<Probe build="solo" height={120} editor={solo} />, host);
    await flush();
    render(<Probe build="collab" height={0} editor={solo} />, host);
    await Promise.resolve();

    render(<Probe build="collab" height={80} editor={{}} />, host);
    await flush();
    expect(wrap().style.minHeight).toBe("");
    expect(wrap().offsetHeight).toBe(80);
  });

  // Text that becomes shorter is not a rebuild.
  it("does not hold a height that changes in place", async () => {
    const solo = {};
    render(<Probe build="solo" height={120} editor={solo} />, host);
    await flush();

    render(<Probe build="solo" height={40} editor={solo} />, host);
    await flush();
    expect(wrap().style.minHeight).toBe("");
    expect(wrap().offsetHeight).toBe(40);
  });

  // With only the height kept, the text was empty for the frames that the new
  // editor took to build.
  it("leaves an inert copy of the old content until the new editor", async () => {
    const solo = {};
    render(<Probe build="solo" height={120} editor={solo} />, host);
    await flush();
    render(<Probe build="collab" height={0} editor={solo} />, host);
    await Promise.resolve();

    const copy = wrap().querySelector<HTMLElement>("[data-held-copy]");
    expect(copy?.inert).toBe(true);
    expect(copy?.getAttribute("aria-hidden")).toBe("true");

    render(<Probe build="collab" height={80} editor={{}} />, host);
    await flush();
    expect(wrap().querySelector("[data-held-copy]")).toBeNull();
    // The removal of the copy is not a new rebuild.
    await Promise.resolve();
    expect(wrap().style.minHeight).toBe("");
  });
});
