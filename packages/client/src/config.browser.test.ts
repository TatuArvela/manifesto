import { describe, expect, test } from "vitest";
import {
  APP_FILE_SLUG,
  APP_LOGO_URL,
  APP_NAME,
  resolveAppName,
  resolveWelcomeEnabled,
  toFileSlug,
  WELCOME_ENABLED,
} from "./config.js";

/**
 * Run `fn` with an `application-name` meta tag in the document, the state a
 * hand-edited release bundle is in when it loads.
 */
function withMetaTag<T>(
  content: string,
  fn: () => T,
  name = "application-name",
): T {
  const meta = document.createElement("meta");
  meta.name = name;
  meta.content = content;
  document.head.appendChild(meta);
  try {
    return fn();
  } finally {
    meta.remove();
  }
}

describe("APP_NAME", () => {
  // The test HTML carries no `application-name` meta tag, so this exercises the
  // build-time half: `VITE_APP_NAME` is unset, so `__APP_NAME__` is the default.
  test("falls back to the built-in name when nothing overrides it", () => {
    expect(APP_NAME).toBe("Manifesto");
    expect(APP_FILE_SLUG).toBe("manifesto");
  });
});

describe("APP_LOGO_URL", () => {
  // The header mark is a plain file at a fixed path rather than a hashed
  // bundled import, so a rebrand can overwrite it in a built bundle.
  test("points at logo.svg under the deployment base", () => {
    expect(APP_LOGO_URL).toBe(`${import.meta.env.BASE_URL}logo.svg`);
    expect(APP_LOGO_URL.endsWith("/logo.svg")).toBe(true);
  });
});

describe("resolveAppName()", () => {
  // The rename path for someone deploying the release zip: edit the meta tag,
  // no rebuild.
  test("prefers an application-name meta tag over the built-in name", () => {
    expect(withMetaTag("Notes", () => resolveAppName("Manifesto"))).toBe(
      "Notes",
    );
  });

  test("ignores an unsubstituted build placeholder", () => {
    expect(withMetaTag("%APP_NAME%", () => resolveAppName("Manifesto"))).toBe(
      "Manifesto",
    );
  });

  test("ignores an emptied-out meta tag", () => {
    expect(withMetaTag("   ", () => resolveAppName("Manifesto"))).toBe(
      "Manifesto",
    );
  });

  test("falls back when the document has no such tag", () => {
    expect(resolveAppName("Manifesto")).toBe("Manifesto");
  });
});

describe("WELCOME_ENABLED", () => {
  test("is on when nothing switches it off", () => {
    expect(WELCOME_ENABLED).toBe(true);
  });
});

describe("resolveWelcomeEnabled()", () => {
  const withTag = (content: string, fallback: boolean) =>
    withMetaTag(
      content,
      () => resolveWelcomeEnabled(fallback),
      "welcome-dialog",
    );

  test("lets a release bundle's meta tag switch it off, or back on", () => {
    expect(withTag("off", true)).toBe(false);
    expect(withTag("ON", false)).toBe(true);
  });

  test("keeps the build's choice for a placeholder or a value it does not know", () => {
    expect(withTag("%APP_WELCOME%", true)).toBe(true);
    expect(withTag("maybe", false)).toBe(false);
  });
});

describe("toFileSlug()", () => {
  test("lowercases and hyphenates", () => {
    expect(toFileSlug("Acme Notes")).toBe("acme-notes");
  });

  test("folds diacritics instead of dropping the letters", () => {
    expect(toFileSlug("Müistiö")).toBe("muistio");
  });

  test("trims punctuation from both ends", () => {
    expect(toFileSlug("¡Notas!")).toBe("notas");
  });

  test("falls back when nothing sluggable is left", () => {
    expect(toFileSlug("メモ")).toBe("notes");
    expect(toFileSlug("   ")).toBe("notes");
  });
});
