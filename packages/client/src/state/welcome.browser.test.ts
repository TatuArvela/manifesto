import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showWelcome } from "./ui.js";
import { markWelcomed, welcomeIfNew } from "./welcome.js";

// The test build is open mode with the dialog left on, which is the default a
// fresh instance ships with.
describe("welcomeIfNew", () => {
  beforeEach(() => {
    localStorage.clear();
    showWelcome.value = false;
  });

  afterEach(() => {
    localStorage.clear();
    showWelcome.value = false;
  });

  it("greets a browser that has never been here", () => {
    welcomeIfNew();
    expect(showWelcome.value).toBe(true);
  });

  it("greets once: a dismissal is remembered", () => {
    markWelcomed();
    welcomeIfNew();
    expect(showWelcome.value).toBe(false);
  });

  it("does not greet someone who already has notes from before it existed", () => {
    localStorage.setItem("manifesto:notes", "[]");
    welcomeIfNew();
    expect(showWelcome.value).toBe(false);
    // And stays quiet if those notes are later cleared out.
    localStorage.removeItem("manifesto:notes");
    welcomeIfNew();
    expect(showWelcome.value).toBe(false);
  });
});
