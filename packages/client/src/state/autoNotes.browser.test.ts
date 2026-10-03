import { type Note, NoteColor, NoteFont } from "@manifesto/shared";
import { signal } from "@preact/signals";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addPlugin,
  declaredReads,
  grantedReads,
  plugins,
  removePlugin,
  setPluginReads,
  togglePlugin,
} from "../autoNotes/registry.js";
import { resetSandbox } from "../autoNotes/sandbox.js";
import { defined } from "../test/defined.js";
import {
  autoNotes,
  drawnWithoutImages,
  generatedNotes,
  initAutoNotes,
  MAX_CONTENT_READ,
  MAX_NOTES_READ,
  notesFor,
  refreshAutoNotes,
} from "./autoNotes.js";
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
    expect(note?.title).toBe("Hello");
    expect(note?.content).toBe("world");
    expect(note?.readonly).toBe(true);
    expect(note?.id.startsWith("generated:")).toBe(true);
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
    expect(note?.title).toMatch(/Bad/);
    expect(note?.content).toMatch(/nope/);
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

describe("auto-notes that read notes", () => {
  const held = signal<Note[]>([]);
  let stop: (() => void) | null = null;

  function note(overrides: Partial<Note>): Note {
    return {
      id: "n1",
      title: "Shopping",
      content: "- [ ] milk",
      color: NoteColor.Default,
      font: NoteFont.Default,
      pinned: false,
      archived: false,
      trashed: false,
      trashedAt: null,
      position: 0,
      tags: ["todo"],
      images: ["attachment:abc"],
      linkPreviews: [],
      reminder: null,
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
      ...overrides,
    };
  }

  const READER = [
    "// @title Open tasks",
    "// @reads todo",
    "_default = (ctx) => ({",
    '  title: "Tasks",',
    '  content: ctx.notes.map((n) => n.title).join(",") || "none",',
    "});",
  ].join("\n");

  const content = () => generatedNotes.value[0]?.content;

  beforeEach(() => {
    localStorage.clear();
    plugins.value = [];
    autoNotes.value = [];
    held.value = [];
    locale.value = "en";
    stop = initAutoNotes(() => held.value);
  });

  afterEach(() => {
    stop?.();
    stop = null;
    resetSandbox();
    plugins.value = [];
    autoNotes.value = [];
    localStorage.clear();
  });

  it("shows a plugin only what its tags cover, and nothing that points outside a note", () => {
    const shown = notesFor(
      ["todo"],
      [
        note({}),
        note({ id: "n2", tags: ["work"] }),
        note({ id: "n3", trashed: true }),
        note({
          id: "n4",
          archived: true,
          updatedAt: "2026-04-03T00:00:00.000Z",
        }),
      ],
    );
    expect(shown.map((n) => n.id)).toEqual(["n4", "n1"]);
    expect(Object.keys(shown[0] ?? {}).sort()).toEqual([
      "archived",
      "color",
      "content",
      "createdAt",
      "id",
      "pinned",
      "tags",
      "title",
      "updatedAt",
    ]);
    expect(notesFor([], [note({})])).toEqual([]);
  });

  it("caps how many notes and how much of each a plugin is shown", () => {
    const many = Array.from({ length: MAX_NOTES_READ + 20 }, (_, i) =>
      note({ id: `n${i}`, content: "x".repeat(MAX_CONTENT_READ + 5) }),
    );
    const shown = notesFor(["todo"], many);
    expect(shown).toHaveLength(MAX_NOTES_READ);
    expect(shown[0]?.content).toHaveLength(MAX_CONTENT_READ);
  });

  it("reads nothing until the user allows the tags its source asks for", async () => {
    held.value = [note({})];
    const plugin = addPlugin({ kind: "inline", source: READER });
    await waitFor(() => content() === "none");
    expect(declaredReads(plugin)).toEqual(["todo"]);
    expect(grantedReads(plugin)).toEqual([]);
    expect(drawnWithoutImages(defined(generatedNotes.value[0]))).toBe(false);

    setPluginReads(plugin.id, ["todo"]);
    await waitFor(() => content() === "Shopping");
    expect(drawnWithoutImages(defined(generatedNotes.value[0]))).toBe(true);

    // And nothing again once the allowance is taken back. The card made
    // while it was reading stays without images until a run replaces it.
    setPluginReads(plugin.id, []);
    expect(content()).toBe("Shopping");
    expect(drawnWithoutImages(defined(generatedNotes.value[0]))).toBe(true);
    await waitFor(() => content() === "none");
    expect(drawnWithoutImages(defined(generatedNotes.value[0]))).toBe(false);
  });

  it("reads the notes of a tag nested under one it reads", () => {
    const shown = notesFor(
      ["todo"],
      [
        note({ id: "n1", tags: ["todo/home"] }),
        note({ id: "n2", tags: ["todos"] }),
      ],
    );
    expect(shown.map((n) => n.id)).toEqual(["n1"]);
  });

  it("keeps what one plugin read from the plugin that runs after it", async () => {
    held.value = [note({})];
    const stasher = [
      "// @title Stasher",
      "// @reads todo",
      "_default = (ctx) => {",
      "  self.stash = ctx.notes.map((n) => n.title).join();",
      '  return { title: "S", content: "" };',
      "};",
    ].join("\n");
    const taker = [
      "// @title Taker",
      '_default = () => ({ title: "T", content: String(self.stash) });',
    ].join("\n");
    const first = addPlugin({ kind: "inline", source: stasher });
    addPlugin({ kind: "inline", source: taker });
    setPluginReads(first.id, ["todo"]);
    refreshAutoNotes();
    await waitFor(() => generatedNotes.value.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const taken = generatedNotes.value.find((n) => n.title === "T");
    expect(taken?.content).toBe("undefined");
  });

  it("does not read a tag the user allowed once the source stops asking", async () => {
    held.value = [note({})];
    const plugin = addPlugin({ kind: "inline", source: READER });
    setPluginReads(plugin.id, ["todo", "private"]);
    await waitFor(() => content() === "Shopping");
    const [stored] = plugins.value;
    // Allowed more than it asks for: only what it asks for is read.
    expect(grantedReads(defined(stored))).toEqual(["todo"]);
  });

  it("runs again a moment after a note it reads changes, and not for others", async () => {
    held.value = [note({})];
    const plugin = addPlugin({ kind: "inline", source: READER });
    setPluginReads(plugin.id, ["todo"]);
    await waitFor(() => content() === "Shopping");

    held.value = [
      note({ title: "Groceries", updatedAt: "2026-04-05T00:00:00.000Z" }),
    ];
    await waitFor(() => content() === "Groceries");

    const before = autoNotes.value;
    held.value = [
      ...held.value,
      note({ id: "other", tags: ["work"], title: "Elsewhere" }),
    ];
    await new Promise((r) => setTimeout(r, 1300));
    // Out of scope: the plugin was not run again at all.
    expect(autoNotes.value).toBe(before);
  });
});
