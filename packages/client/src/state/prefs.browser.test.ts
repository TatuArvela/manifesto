import { NoteFont } from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  animations,
  darkHue,
  defaultNoteColor,
  defaultNoteFont,
  locale,
  noteCorners,
  noteQuips,
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

describe("noteCorners", () => {
  it("defaults to straight, preserving the original square note look", () => {
    expect(parsePrefs(null).noteCorners).toBe("straight");
    expect(parsePrefs("{}").noteCorners).toBe("straight");
  });

  it("round-trips a persisted value", () => {
    expect(parsePrefs('{"noteCorners":"rounded"}').noteCorners).toBe("rounded");
  });

  it("falls back to straight for an unrecognised value", () => {
    expect(parsePrefs('{"noteCorners":"bevelled"}').noteCorners).toBe(
      "straight",
    );
  });

  it("toggles the html class the note surfaces read their radius from", () => {
    noteCorners.value = "rounded";
    expect(document.documentElement.classList.contains("notes-rounded")).toBe(
      true,
    );
    noteCorners.value = "straight";
    expect(document.documentElement.classList.contains("notes-rounded")).toBe(
      false,
    );
  });
});

describe("animations", () => {
  it("honours an explicitly persisted choice", () => {
    expect(parsePrefs('{"animations":false}').animations).toBe(false);
    expect(parsePrefs('{"animations":true}').animations).toBe(true);
  });

  it("falls back to the OS motion setting when nothing is persisted", () => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    expect(parsePrefs(null).animations).toBe(!reduced);
    expect(parsePrefs("{}").animations).toBe(!reduced);
  });

  it("toggles the html class that collapses motion", () => {
    animations.value = false;
    expect(document.documentElement.classList.contains("no-motion")).toBe(true);
    animations.value = true;
    expect(document.documentElement.classList.contains("no-motion")).toBe(
      false,
    );
  });
});

describe("darkHue", () => {
  it("defaults to neutral, reproducing Tailwind's untinted grey", () => {
    expect(parsePrefs(null).darkHue).toBe("neutral");
    expect(parsePrefs("{}").darkHue).toBe("neutral");
  });

  it("round-trips a persisted value", () => {
    expect(parsePrefs('{"darkHue":"slate"}').darkHue).toBe("slate");
  });

  it("accepts the dimmed shades alongside the tints", () => {
    expect(parsePrefs('{"darkHue":"midnight"}').darkHue).toBe("midnight");
    expect(parsePrefs('{"darkHue":"black"}').darkHue).toBe("black");
  });

  it("falls back to neutral for an unrecognised value", () => {
    expect(parsePrefs('{"darkHue":"chartreuse"}').darkHue).toBe("neutral");
  });

  it("publishes the hue on <html> for the stylesheet to key off", () => {
    const previous = darkHue.value;
    darkHue.value = "mauve";
    expect(document.documentElement.dataset.darkHue).toBe("mauve");
    darkHue.value = "neutral";
    expect(document.documentElement.dataset.darkHue).toBe("neutral");
    darkHue.value = previous;
  });
});

describe("noteQuips", () => {
  it("defaults to on", () => {
    expect(parsePrefs(null).noteQuips).toBe(true);
    expect(parsePrefs("{}").noteQuips).toBe(true);
  });

  it("honours an explicitly persisted choice", () => {
    expect(parsePrefs('{"noteQuips":false}').noteQuips).toBe(false);
    expect(parsePrefs('{"noteQuips":true}').noteQuips).toBe(true);
  });

  it("is exported as a signal so the note stack can read it", () => {
    expect(typeof noteQuips.value).toBe("boolean");
  });
});

describe("formattingToolbar", () => {
  it("defaults to shown", () => {
    expect(parsePrefs(null).formattingToolbar).toBe(true);
    expect(parsePrefs("{}").formattingToolbar).toBe(true);
  });

  it("honours an explicitly persisted choice", () => {
    expect(parsePrefs('{"formattingToolbar":false}').formattingToolbar).toBe(
      false,
    );
  });
});

describe("defaultEditMode", () => {
  it("defaults to the normal editor", () => {
    expect(parsePrefs(null).defaultEditMode).toBe("normal");
    expect(parsePrefs('{"defaultEditMode":"bogus"}').defaultEditMode).toBe(
      "normal",
    );
  });

  it("honours raw once chosen", () => {
    expect(parsePrefs('{"defaultEditMode":"raw"}').defaultEditMode).toBe("raw");
  });
});

describe("cross-tab preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    theme.value = "system";
    viewMode.value = "grid";
  });

  afterEach(() => {
    localStorage.clear();
    theme.value = "system";
    viewMode.value = "grid";
  });

  /**
   * What the browser delivers to the *other* tabs after a write. The event
   * never fires in the tab that wrote, which is why adopting it cannot loop.
   */
  function otherTabWrote(prefs: Record<string, unknown>) {
    const value = JSON.stringify(prefs);
    localStorage.setItem(PREFS_KEY, value);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: PREFS_KEY,
        newValue: value,
        storageArea: localStorage,
      }),
    );
  }

  it("adopts a preference another tab changed", () => {
    otherTabWrote({ theme: "dark", viewMode: "grid" });
    expect(theme.value).toBe("dark");
  });

  it("does not overwrite it with a stale copy on the next local change", async () => {
    // The whole blob is written on every change, so a tab that never heard
    // about the other's edit puts its own old value back: change the theme in
    // one tab, switch view mode in another, and the theme is light again.
    otherTabWrote({ theme: "dark", viewMode: "grid" });

    viewMode.value = "list";
    await new Promise((resolve) => setTimeout(resolve, 100));

    const persisted = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    expect(persisted.theme).toBe("dark");
    expect(persisted.viewMode).toBe("list");
  });

  it("does not write back what it just adopted", async () => {
    // Let any save this test's own setup queued run first, so what we look
    // for afterwards can only have come from adopting.
    await new Promise((resolve) => setTimeout(resolve, 100));
    otherTabWrote({ theme: "dark", viewMode: "grid" });
    localStorage.removeItem(PREFS_KEY);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(localStorage.getItem(PREFS_KEY)).toBe(null);
  });

  it("ignores writes to other keys", () => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "manifesto:notes",
        newValue: "[]",
        storageArea: localStorage,
      }),
    );
    expect(theme.value).toBe("system");
  });
});
