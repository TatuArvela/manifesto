import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "./usePresence.js";

let host: HTMLDivElement;
let latest: { shown: string | null; leaving: boolean };

function Probe({ value }: { value: string | null }) {
  latest = usePresence(value, 100);
  return null;
}

/** Preact runs effects after paint; give it a frame and a tick. */
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

describe("usePresence", () => {
  it("keeps a closed value on screen, leaving, until its exit has played", async () => {
    render(<Probe value="menu" />, host);
    await flush();
    expect(latest).toEqual({ shown: "menu", leaving: false });

    render(<Probe value={null} />, host);
    expect(latest).toEqual({ shown: "menu", leaving: true });

    await vi.waitFor(() =>
      expect(latest).toEqual({ shown: null, leaving: false }),
    );
  });

  it("hands over to a new value at once, with no exit", async () => {
    render(<Probe value="menu" />, host);
    await flush();
    render(<Probe value="reminder" />, host);
    expect(latest).toEqual({ shown: "reminder", leaving: false });
  });

  it("comes back if reopened while leaving, and stays", async () => {
    render(<Probe value="menu" />, host);
    await flush();
    render(<Probe value={null} />, host);
    await flush();
    render(<Probe value="menu" />, host);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(latest).toEqual({ shown: "menu", leaving: false });
  });
});
