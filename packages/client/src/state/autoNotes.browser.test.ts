import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addPlugin,
  plugins,
  removePlugin,
  togglePlugin,
} from "../autoNotes/registry.js";
import { resetSandbox } from "../autoNotes/sandbox.js";
import { autoNotes, generatedNotes, initAutoNotes } from "./autoNotes.js";
import { locale } from "./prefs.js";

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for predicate");
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("state/autoNotes", () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    localStorage.clear();
    plugins.value = [];
    autoNotes.value = [];
    locale.value = "en";
    stop = initAutoNotes();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    resetSandbox();
    plugins.value = [];
    autoNotes.value = [];
    localStorage.clear();
  });

  it("a registered plugin becomes a generated note", async () => {
    addPlugin({
      kind: "inline",
      source: `// @title Greeter\n_default = () => ({ title: "Hello", content: "world" });`,
    });

    await waitFor(() => generatedNotes.value.length === 1);

    const note = generatedNotes.value[0];
    expect(note.title).toBe("Hello");
    expect(note.content).toBe("world");
    expect(note.readonly).toBe(true);
    expect(note.id.startsWith("generated:")).toBe(true);
  });

  it("returning an array yields multiple notes", async () => {
    addPlugin({
      kind: "inline",
      source: `// @title Multi\n_default = [
        () => ({ title: "A", content: "one", key: "a" }),
        () => ({ title: "B", content: "two", key: "b" }),
      ];`,
    });

    await waitFor(() => generatedNotes.value.length === 2);
    expect(generatedNotes.value.map((n) => n.title).sort()).toEqual(["A", "B"]);
  });

  it("disabling a plugin removes its notes", async () => {
    const p = addPlugin({
      kind: "inline",
      source: `// @title Toggle\n_default = () => ({ title: "X", content: "y" });`,
    });

    await waitFor(() => generatedNotes.value.length === 1);
    togglePlugin(p.id);
    await waitFor(() => generatedNotes.value.length === 0);
  });

  it("a throwing plugin surfaces as an error note", async () => {
    addPlugin({
      kind: "inline",
      source: `// @title Bad\n_default = () => { throw new Error("nope"); };`,
    });

    await waitFor(() => generatedNotes.value.length === 1);
    const note = generatedNotes.value[0];
    expect(note.title).toMatch(/Bad/);
    expect(note.content).toMatch(/nope/);
  });

  it("removing a plugin drops its notes", async () => {
    const p = addPlugin({
      kind: "inline",
      source: `// @title Temp\n_default = () => ({ title: "T", content: "t" });`,
    });
    await waitFor(() => generatedNotes.value.length === 1);
    removePlugin(p.id);
    await waitFor(() => generatedNotes.value.length === 0);
  });

  it("rejects a plugin without a @title directive", () => {
    expect(() =>
      addPlugin({
        kind: "inline",
        source: `_default = () => ({ title: "X", content: "y" });`,
      }),
    ).toThrow(/@title/);
  });
});
