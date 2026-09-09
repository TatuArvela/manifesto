import { MAX_IMAGE_SOURCE_BYTES } from "@manifesto/shared";
import { beforeEach, describe, expect, test } from "vitest";
import { APP_NAME } from "../config.js";
import { locale } from "../state/prefs.js";
import { detectBrowserLocale } from "./detect.js";
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  plural,
  t,
} from "./index.js";
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

  // The product name is a build-time parameter, so no catalogue spells it out:
  // messages carry `{appName}` and t() fills it in without being asked.
  test("fills {appName} from the build-time app name", () => {
    expect(t("login.title")).toBe(`Sign in to ${APP_NAME}`);
    expect(t("error.body")).toContain(APP_NAME);
  });

  test("fills {appName} in translations too", () => {
    locale.value = "fi";
    expect(t("login.title")).toBe(`Kirjaudu palveluun ${APP_NAME}`);
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
  // A hard-coded product name would survive a rebrand and read as someone
  // else's app, so the catalogues must go through `{appName}` instead.
  test("no catalogue hard-codes the default product name", () => {
    for (const [key, value] of Object.entries({ en, fi })) {
      for (const [messageKey, message] of Object.entries(value)) {
        const text =
          typeof message === "string"
            ? message
            : Object.values(message).join(" ");
        expect(
          text,
          `${key}.${messageKey} hard-codes the app name`,
        ).not.toContain("Manifesto");
      }
    }
  });

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

describe("formatFileSize()", () => {
  test("renders megabytes with the English unit and separator", () => {
    expect(formatFileSize(MAX_IMAGE_SOURCE_BYTES)).toBe("1.5 MB");
  });

  // "Mt" (megatavu) rather than "MB", and a decimal comma. Both come from CLDR
  // rather than from a hand-written translation, which is the point of routing
  // the size through Intl instead of spelling it out in each message.
  test("renders megabytes with the Finnish unit and separator", () => {
    locale.value = "fi";
    expect(formatFileSize(MAX_IMAGE_SOURCE_BYTES)).toBe("1,5 Mt");
  });

  test("the size in the too-large message is the size actually enforced", () => {
    const message = t("editor.imageTooLarge", {
      name: "photo.jpg",
      size: formatFileSize(MAX_IMAGE_SOURCE_BYTES),
    });
    expect(message).toBe("photo.jpg is too large to attach (max 1.5 MB)");
  });
});
