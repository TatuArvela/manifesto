import { beforeEach, describe, expect, test } from "vitest";
import { locale } from "../state/prefs.js";
import { detectBrowserLocale } from "./detect.js";
import { formatDate, formatDateTime, plural, t } from "./index.js";
import { en } from "./messages/en.js";
import { fi } from "./messages/fi.js";

beforeEach(() => {
  locale.value = "en";
});

describe("t()", () => {
  test("returns the English source string for a known key", () => {
    expect(t("nav.notes")).toBe("Notes");
  });

  test("returns the Finnish string when locale is fi", () => {
    locale.value = "fi";
    expect(t("nav.notes")).toBe(fi["nav.notes"]);
  });

  test("interpolates {var} placeholders", () => {
    expect(t("editor.removeTag", { tag: "work" })).toBe("Remove tag work");
  });

  test("leaves unknown placeholders untouched", () => {
    const raw = en["editor.removeTag"] as string;
    expect(t("editor.removeTag")).toBe(raw);
  });
});

describe("plural()", () => {
  test("returns the 'one' form for n === 1 in English", () => {
    expect(plural("settings.data.importedCount", 1)).toBe("Imported 1 note");
  });

  test("returns the 'other' form for n !== 1 in English", () => {
    expect(plural("settings.data.importedCount", 0)).toBe("Imported 0 notes");
    expect(plural("settings.data.importedCount", 2)).toBe("Imported 2 notes");
  });

  test("returns the 'one' form for n === 1 in Finnish", () => {
    locale.value = "fi";
    const expected = (fi["settings.data.importedCount"] as { one: string }).one;
    expect(plural("settings.data.importedCount", 1)).toBe(
      expected.replace("{count}", "1"),
    );
  });

  test("allows overriding {count} via vars", () => {
    expect(plural("settings.data.importedCount", 3, { count: "three" })).toBe(
      "Imported three notes",
    );
  });
});

describe("formatDateTime / formatDate", () => {
  test("formats in the active locale", () => {
    const iso = "2026-04-21T12:34:00Z";
    expect(typeof formatDateTime(iso)).toBe("string");
    expect(typeof formatDate(iso)).toBe("string");
  });
});

describe("detectBrowserLocale()", () => {
  test("returns 'fi' for ['fi-FI', 'en']", () => {
    expect(detectBrowserLocale(["fi-FI", "en"])).toBe("fi");
  });

  test("returns 'en' for ['de', 'fr']", () => {
    expect(detectBrowserLocale(["de", "fr"])).toBe("en");
  });

  test("returns 'en' for []", () => {
    expect(detectBrowserLocale([])).toBe("en");
  });

  test("handles underscore locale tags", () => {
    expect(detectBrowserLocale(["fi_FI"])).toBe("fi");
  });
});

describe("message shape parity", () => {
  test("every English key exists in Finnish", () => {
    const enKeys = Object.keys(en);
    const fiKeys = new Set(Object.keys(fi));
    for (const key of enKeys) {
      expect(fiKeys.has(key), `missing fi key: ${key}`).toBe(true);
    }
  });

  test("plural entries in fi have at least the 'other' form", () => {
    for (const [key, value] of Object.entries(fi)) {
      if (typeof value === "object" && value !== null) {
        expect(
          typeof (value as { other?: unknown }).other,
          `plural entry ${key} must have 'other'`,
        ).toBe("string");
      }
    }
  });
});
