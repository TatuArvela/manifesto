import { describe, expect, it, vi } from "vitest";
import { createUpdateReloader } from "./updateReload.js";

function setup({
  hadController = true,
  idle = true,
}: {
  hadController?: boolean;
  idle?: boolean;
} = {}) {
  const state = { idle };
  const reload = vi.fn();
  const reloader = createUpdateReloader({
    hadController,
    isIdle: () => state.idle,
    reload,
  });
  return { reloader, reload, state };
}

describe("createUpdateReloader", () => {
  it("does not reload when the first worker claims the page", () => {
    // A first visit: no controller at load, then the worker installs and
    // claims. That is a controller change with nothing newer behind it.
    const { reloader, reload } = setup({ hadController: false });

    reloader.controllerChanged();
    reloader.visibilityChanged();

    expect(reload).not.toHaveBeenCalled();
  });

  it("treats the change after that first claim as an update", () => {
    const { reloader, reload } = setup({ hadController: false });

    reloader.controllerChanged();
    reloader.controllerChanged();
    reloader.visibilityChanged();

    expect(reload).toHaveBeenCalledOnce();
  });

  it("waits for the page to be hidden or shown rather than reloading at once", () => {
    const { reloader, reload } = setup();

    reloader.controllerChanged();
    expect(reload).not.toHaveBeenCalled();

    reloader.visibilityChanged();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("holds the reload while something is open, and takes the next moment", () => {
    const { reloader, reload, state } = setup({ idle: false });

    reloader.controllerChanged();
    reloader.visibilityChanged();
    expect(reload).not.toHaveBeenCalled();
    expect(reloader.pending).toBe(true);

    state.idle = true;
    reloader.visibilityChanged();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("never reloads without an update", () => {
    const { reloader, reload } = setup();

    reloader.visibilityChanged();
    reloader.visibilityChanged();

    expect(reload).not.toHaveBeenCalled();
  });
});
