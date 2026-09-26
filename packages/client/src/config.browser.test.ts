import { describe, expect, test } from "vitest";
import {
  APP_FILE_SLUG,
  APP_LOGO_URL,
  APP_NAME,
  INSTANCE_NAME,
  ORG_LOGO_URL,
  ORG_NAME,
  resolveAppName,
  resolveBrandText,
  resolveLogoUrl,
  resolveServerUrl,
  resolveWelcomeEnabled,
  toFileSlug,
  WELCOME_ENABLED,
  WINDOW_TITLE,
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

describe("the deployment's own branding", () => {
  // The test build sets none of it, which is every stock deployment.
  test("is absent unless configured, and the title is the app's name", () => {
    expect(INSTANCE_NAME).toBeNull();
    expect(ORG_NAME).toBeNull();
    expect(ORG_LOGO_URL).toBeNull();
    expect(WINDOW_TITLE).toBe(APP_NAME);
  });
});

describe("resolveBrandText()", () => {
  test("prefers the meta tag, then the build's value", () => {
    expect(
      withMetaTag(
        "Foo QA project",
        () => resolveBrandText("instance-name", "Built"),
        "instance-name",
      ),
    ).toBe("Foo QA project");
    expect(resolveBrandText("instance-name", "Built")).toBe("Built");
  });

  test("is null for an unset, empty or placeholder value", () => {
    expect(resolveBrandText("org-name", "")).toBeNull();
    expect(
      withMetaTag(
        "%ORG_NAME%",
        () => resolveBrandText("org-name", ""),
        "org-name",
      ),
    ).toBeNull();
    expect(
      withMetaTag("  ", () => resolveBrandText("org-name", " "), "org-name"),
    ).toBeNull();
  });
});

describe("resolveLogoUrl()", () => {
  test("puts a bare file name under the deployment base", () => {
    expect(resolveLogoUrl("org-logo.png", "/notes/")).toBe(
      "/notes/org-logo.png",
    );
  });

  test("takes an absolute path or a data URL as it is", () => {
    expect(resolveLogoUrl("/brand/acme.svg", "/notes/")).toBe(
      "/brand/acme.svg",
    );
    expect(resolveLogoUrl("data:image/svg+xml,x", "/")).toBe(
      "data:image/svg+xml,x",
    );
  });

  test("is null for nothing", () => {
    expect(resolveLogoUrl(null)).toBeNull();
    expect(resolveLogoUrl("  ")).toBeNull();
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

describe("resolveServerUrl", () => {
  const TAG = "manifesto-server";

  test("uses the build-time value when the bundle carries no tag", () => {
    expect(resolveServerUrl("https://notes.example.com")).toBe(
      "https://notes.example.com",
    );
    expect(resolveServerUrl(undefined)).toBeNull();
  });

  test("lets a hand-edited tag override the build", () => {
    // The whole point: a zip built in open mode, pointed at a server by
    // editing one line, with no toolchain anywhere.
    expect(
      withMetaTag(
        "https://notes.acme.com",
        () => resolveServerUrl(undefined),
        TAG,
      ),
    ).toBe("https://notes.acme.com");
    expect(
      withMetaTag(
        "https://notes.acme.com",
        () => resolveServerUrl("https://built-in.example.com"),
        TAG,
      ),
    ).toBe("https://notes.acme.com");
  });

  test("treats an empty or unsubstituted tag as absent", () => {
    // The shipped zip is exactly this, and must stay in open mode.
    expect(withMetaTag("", () => resolveServerUrl(undefined), TAG)).toBeNull();
    expect(
      withMetaTag("   ", () => resolveServerUrl(undefined), TAG),
    ).toBeNull();
    expect(
      withMetaTag("%MANIFESTO_SERVER%", () => resolveServerUrl(undefined), TAG),
    ).toBeNull();
    // An empty tag must not shadow a build that does name a server.
    expect(
      withMetaTag("", () => resolveServerUrl("https://notes.example.com"), TAG),
    ).toBe("https://notes.example.com");
  });

  test("strips a trailing slash, so `/` is same-origin and not open mode", () => {
    expect(resolveServerUrl("https://notes.example.com/")).toBe(
      "https://notes.example.com",
    );
    // `/` collapses to the empty string, meaning this page's own origin. It
    // has to stay distinct from null, which is open mode, and every guard
    // downstream tests null rather than falsiness because of it.
    expect(resolveServerUrl("/")).toBe("");
    expect(resolveServerUrl("/")).not.toBeNull();
  });
});
