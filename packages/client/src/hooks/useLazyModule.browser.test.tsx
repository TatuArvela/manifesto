import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLazyModule } from "./useLazyModule.ts";

let host: HTMLDivElement;
let latest: (() => string) | null;

function Probe({
  load,
  wanted,
  onFail,
}: {
  load: () => Promise<() => string>;
  wanted: boolean;
  onFail: () => void;
}) {
  latest = useLazyModule(load, wanted, onFail);
  return null;
}

beforeEach(() => {
  latest = null;
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe("useLazyModule", () => {
  it("fetches nothing until wanted, then keeps what arrived", async () => {
    const component = () => "settings";
    const load = vi.fn(() => Promise.resolve(component));
    const onFail = vi.fn();
    render(<Probe load={load} wanted={false} onFail={onFail} />, host);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(load).not.toHaveBeenCalled();

    render(<Probe load={load} wanted onFail={onFail} />, host);
    // A function, kept as itself rather than called as a state updater.
    await vi.waitFor(() => expect(latest).toBe(component));

    render(<Probe load={load} wanted={false} onFail={onFail} />, host);
    render(<Probe load={load} wanted onFail={onFail} />, host);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(latest).toBe(component);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();
  });

  it("reports a failed fetch, and tries again when next wanted", async () => {
    const component = () => "admin";
    const load = vi
      .fn<() => Promise<() => string>>()
      .mockRejectedValueOnce(new Error("chunk gone"))
      .mockResolvedValueOnce(component);
    const onFail = vi.fn();
    render(<Probe load={load} wanted onFail={onFail} />, host);
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledTimes(1));
    expect(latest).toBeNull();

    render(<Probe load={load} wanted={false} onFail={onFail} />, host);
    render(<Probe load={load} wanted onFail={onFail} />, host);
    await vi.waitFor(() => expect(latest).toBe(component));
    expect(load).toHaveBeenCalledTimes(2);
  });
});
