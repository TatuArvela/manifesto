import { render } from "preact";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollAwayBar } from "./useScrollAwayBar.js";

let host: HTMLDivElement;
let spacer = 0;

function Board({ enabled, hold }: { enabled: boolean; hold: boolean }) {
  const main = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  spacer = useScrollAwayBar(main, bar, enabled, hold);
  return (
    <>
      <div ref={bar} data-bar style={{ height: "100px" }} />
      <main ref={main} style={{ height: "300px", overflowY: "auto" }}>
        <div style={{ height: "2000px" }} />
      </main>
    </>
  );
}

const bar = () => host.querySelector<HTMLElement>("[data-bar]") as HTMLElement;
const main = () => host.querySelector("main") as HTMLElement;
const shift = () => bar().style.getPropertyValue("--bar-shift");

function scrollTo(top: number) {
  main().scrollTop = top;
  main().dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("useScrollAwayBar", () => {
  it("moves the bar up as far as the board scrolled, up to past its height", async () => {
    render(<Board enabled hold={false} />, host);
    await vi.waitFor(() => expect(spacer).toBe(100));
    expect(shift()).toBe("0px");
    scrollTo(40);
    expect(shift()).toBe("40px");
    scrollTo(900);
    // Its height and the room for its shadow, and no further.
    expect(shift()).toBe("108px");
    scrollTo(0);
    expect(shift()).toBe("0px");
  });

  it("brings the bar back while held, whatever the scroll", async () => {
    render(<Board enabled hold={false} />, host);
    await vi.waitFor(() => expect(spacer).toBe(100));
    scrollTo(500);
    render(<Board enabled hold />, host);
    expect(shift()).toBe("0px");
    scrollTo(600);
    expect(shift()).toBe("0px");
  });

  it("leaves the bar alone when off", async () => {
    render(<Board enabled={false} hold={false} />, host);
    scrollTo(500);
    expect(spacer).toBe(0);
    expect(shift()).toBe("");
  });
});
