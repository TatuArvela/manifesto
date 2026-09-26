import { afterEach, describe, expect, it, vi } from "vitest";
import { revealApp } from "./splash.js";

afterEach(() => {
  document.getElementById("splash")?.remove();
});

describe("the loading screen", () => {
  it("stays up until the app says its first screen is there, then goes", async () => {
    const splash = document.createElement("div");
    splash.id = "splash";
    document.body.appendChild(splash);

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(splash.dataset.done).toBeUndefined();

    revealApp();
    await vi.waitFor(() => expect(splash.dataset.done).toBe("true"));
    // Nothing transitions here, so it is the timer that takes it out.
    await vi.waitFor(() => expect(splash.isConnected).toBe(false), {
      timeout: 1500,
    });
  });
});
