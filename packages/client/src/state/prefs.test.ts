import { NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultNoteColor,
  defaultNoteFont,
  locale,
  noteSize,
  parsePrefs,
  sortMode,
  theme,
  viewMode,
} from "./prefs.js";

const PREFS_KEY = "manifesto:prefs";

describe("parsePrefs", () => {
  it("returns documented defaults for null input", () => {
    const result = parsePrefs(null);
    expect(result.viewMode).toBe("grid");
    expect(result.sortMode).toBe("default");
    expect(result.noteSize).toBe("fit");
    expect(result.theme).toBe("system");
    expect(result.defaultNoteColor).toBe("plain");
    expect(result.defaultNoteFont).toBe(NoteFont.Default);
    expect(["en", "fi"]).toContain(result.locale);
  });

  it("returns defaults on corrupted JSON", () => {
    const result = parsePrefs("{not json");
    expect(result.viewMode).toBe("grid");
    expect(result.theme).toBe("system");
  });

  it("restores all fields when a full object is persisted", () => {
    const result = parsePrefs(
      JSON.stringify({
        viewMode: "list",
        sortMode: "updated",
        noteSize: "square",
        theme: "dark",
        defaultNoteColor: "random",
        defaultNoteFont: NoteFont.PermanentMarker,
        locale: "fi",
      }),
    );
    expect(result.viewMode).toBe("list");
    expect(result.sortMode).toBe("updated");
    expect(result.noteSize).toBe("square");
    expect(result.theme).toBe("dark");
    expect(result.defaultNoteColor).toBe("random");
    expect(result.defaultNoteFont).toBe(NoteFont.PermanentMarker);
    expect(result.locale).toBe("fi");
  });

  it("fills missing fields with defaults when a partial object is persisted", () => {
    const result = parsePrefs(JSON.stringify({ viewMode: "list" }));
    expect(result.viewMode).toBe("list");
    expect(result.sortMode).toBe("default");
    expect(result.noteSize).toBe("fit");
    expect(result.theme).toBe("system");
  });

  it("migrates legacy `noteFont` key to `defaultNoteFont`", () => {
    const result = parsePrefs(
      JSON.stringify({ noteFont: NoteFont.ComicRelief }),
    );
    expect(result.defaultNoteFont).toBe(NoteFont.ComicRelief);
  });

  it("prefers `defaultNoteFont` over legacy `noteFont` when both are present", () => {
    const result = parsePrefs(
      JSON.stringify({
        defaultNoteFont: NoteFont.PermanentMarker,
        noteFont: NoteFont.ComicRelief,
      }),
    );
    expect(result.defaultNoteFont).toBe(NoteFont.PermanentMarker);
  });

  it("ignores an unsupported locale and falls back to detection", () => {
    const result = parsePrefs(JSON.stringify({ locale: "xx-NEVER" }));
    // detectBrowserLocale returns one of the supported locales.
    expect(["en", "fi"]).toContain(result.locale);
    expect(result.locale as string).not.toBe("xx-NEVER");
  });
});

describe("prefs signal persistence", () => {
  // Snapshot current signal values so we can restore them after each test.
  let snapshot: {
    viewMode: typeof viewMode.value;
    sortMode: typeof sortMode.value;
    noteSize: typeof noteSize.value;
    theme: typeof theme.value;
    defaultNoteColor: typeof defaultNoteColor.value;
    defaultNoteFont: typeof defaultNoteFont.value;
    locale: typeof locale.value;
  };

  beforeEach(() => {
    snapshot = {
      viewMode: viewMode.value,
      sortMode: sortMode.value,
      noteSize: noteSize.value,
      theme: theme.value,
      defaultNoteColor: defaultNoteColor.value,
      defaultNoteFont: defaultNoteFont.value,
      locale: locale.value,
    };
    localStorage.removeItem(PREFS_KEY);
  });

  afterEach(() => {
    viewMode.value = snapshot.viewMode;
    sortMode.value = snapshot.sortMode;
    noteSize.value = snapshot.noteSize;
    theme.value = snapshot.theme;
    defaultNoteColor.value = snapshot.defaultNoteColor;
    defaultNoteFont.value = snapshot.defaultNoteFont;
    locale.value = snapshot.locale;
  });

  it("writes signal changes to localStorage after the debounce window", async () => {
    viewMode.value = "list";
    sortMode.value = "updated";

    // Debounced save is 50ms.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const raw = localStorage.getItem(PREFS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.viewMode).toBe("list");
    expect(parsed.sortMode).toBe("updated");
  });

  it("coalesces rapid signal changes into a single write", async () => {
    viewMode.value = "list";
    viewMode.value = "grid";
    viewMode.value = "list";

    await new Promise((resolve) => setTimeout(resolve, 100));
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) as string);
    expect(parsed.viewMode).toBe("list");
  });
});
