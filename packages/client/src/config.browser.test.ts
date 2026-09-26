import { describe, expect, test } from "vitest";
import {
  APP_FILE_SLUG,
  APP_LOGO,
  APP_NAME,
  applyFavicon,
  FAVICON,
  HEADER_BRAND,
  INSTANCE_LOGO,
  INSTANCE_NAME,
  ORG_LOGO,
  ORG_NAME,
  resolveAppName,
  resolveBrandText,
  resolveHeaderBrand,
  resolveLogo,
  resolveLogoUrl,
  resolveServerUrl,
  resolveWelcomeEnabled,
  toFileSlug,
  WELCOME_ENABLED,
  WINDOW_TITLE,
  windowTitle,
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

describe("APP_LOGO", () => {
  // The header mark is a plain file at a fixed path rather than a hashed
  // bundled import, so a rebrand can overwrite it in a built bundle.
  test("points at logo.svg under the deployment base", () => {
    expect(APP_LOGO).toEqual({
      light: `${import.meta.env.BASE_URL}logo.svg`,
      dark: null,
      invertInDark: true,
    });
  });
});

describe("the deployment's own branding", () => {
  // The test build sets none of it, which is every stock deployment.
  test("is absent unless configured, and the title is the app's name", () => {
    expect(INSTANCE_NAME).toBeNull();
    expect(ORG_NAME).toBeNull();
    expect(ORG_LOGO).toBeNull();
    expect(WINDOW_TITLE).toBe(APP_NAME);
    expect(INSTANCE_LOGO).toBeNull();
  });

  test("leaves the top bar to the app", () => {
    expect(HEADER_BRAND).toEqual({
      name: APP_NAME,
      logo: APP_LOGO,
      isInstance: false,
    });
  });
});

describe("the tab's icon", () => {
  test("stays the page's own while the app is the brand", () => {
    expect(FAVICON).toBeNull();
  });

  test("becomes the instance logo it is handed, whatever its type", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.head.innerHTML =
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';
    applyFavicon(
      { light: "/instance-logo.png", dark: null, invertInDark: false },
      doc,
    );
    const link = doc.querySelector("link[rel=icon]");
    expect(link?.getAttribute("href")).toBe("/instance-logo.png");
    expect(link?.hasAttribute("type")).toBe(false);
  });

  test("follows the browser's scheme to a dark variant, in one link", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.head.innerHTML = '<link rel="icon" href="/favicon.svg" />';
    let onChange = () => {};
    const scheme = {
      matches: true,
      addEventListener: (_type: string, listener: () => void) => {
        onChange = listener;
      },
    };
    applyFavicon(
      { light: "/i.svg", dark: "/i-dark.svg", invertInDark: false },
      doc,
      scheme as unknown as MediaQueryList,
    );
    const hrefs = () =>
      [...doc.querySelectorAll("link[rel=icon]")].map((l) =>
        l.getAttribute("href"),
      );
    expect(hrefs()).toEqual(["/i-dark.svg"]);
    expect(doc.querySelector("link[rel=icon]")?.hasAttribute("media")).toBe(
      false,
    );

    scheme.matches = false;
    onChange();
    expect(hrefs()).toEqual(["/i.svg"]);
  });

  test("is left alone with nothing to put there", () => {
    const doc = document.implementation.createHTMLDocument();
    doc.head.innerHTML = '<link rel="icon" href="/favicon.svg" />';
    applyFavicon(null, doc);
    expect(doc.querySelector("link[rel=icon]")?.getAttribute("href")).toBe(
      "/favicon.svg",
    );
  });
});

describe("resolveLogo()", () => {
  test("pairs a logo with its dark variant, from the tags or the build", () => {
    expect(
      resolveLogo(
        "org-logo",
        { light: "acme.svg", dark: "acme-dark.svg" },
        false,
      ),
    ).toEqual({
      light: `${import.meta.env.BASE_URL}acme.svg`,
      dark: `${import.meta.env.BASE_URL}acme-dark.svg`,
      invertInDark: false,
    });
    expect(
      withMetaTag(
        "/brand/dark.svg",
        () =>
          resolveLogo("org-logo", { light: "acme.svg", dark: "" }, false)?.dark,
        "org-logo-dark",
      ),
    ).toBe("/brand/dark.svg");
  });

  test("is nothing without a light logo, whatever the dark one says", () => {
    expect(
      resolveLogo("org-logo", { light: "", dark: "acme-dark.svg" }, false),
    ).toBeNull();
  });
});

describe("windowTitle()", () => {
  test("puts the instance first and the app after it", () => {
    expect(windowTitle("Manifesto", "Foo QA project", true)).toBe(
      "Foo QA project · Manifesto",
    );
  });

  test("leaves the app's name out when switched off, by build or tag", () => {
    expect(windowTitle("Manifesto", "Foo QA project", false)).toBe(
      "Foo QA project",
    );
    expect(
      withMetaTag(
        "off",
        () => windowTitle("Manifesto", "Foo QA project", true),
        "title-app-name",
      ),
    ).toBe("Foo QA project");
    expect(
      withMetaTag(
        "on",
        () => windowTitle("Manifesto", "Foo QA project", false),
        "title-app-name",
      ),
    ).toBe("Foo QA project · Manifesto");
  });

  test("keeps the build's choice for a placeholder", () => {
    expect(
      withMetaTag(
        "%TITLE_APP_NAME%",
        () => windowTitle("Manifesto", "Foo QA project", false),
        "title-app-name",
      ),
    ).toBe("Foo QA project");
  });

  test("is the app's name without an instance, whatever the setting", () => {
    expect(windowTitle("Manifesto", null, false)).toBe("Manifesto");
  });
});

describe("resolveHeaderBrand()", () => {
  test("gives the top bar to an instance that has a name", () => {
    expect(resolveHeaderBrand("instance", "Foo QA project")).toBe("instance");
    expect(
      withMetaTag(
        "Instance",
        () => resolveHeaderBrand("app", "Foo QA project"),
        "header-brand",
      ),
    ).toBe("instance");
  });

  test("keeps the app there otherwise", () => {
    // Nothing to put in its place.
    expect(resolveHeaderBrand("instance", null)).toBe("app");
    expect(resolveHeaderBrand("app", "Foo QA project")).toBe("app");
    expect(resolveHeaderBrand("sideways", "Foo QA project")).toBe("app");
    expect(
      withMetaTag(
        "%HEADER_BRAND%",
        () => resolveHeaderBrand("app", "Foo QA project"),
        "header-brand",
      ),
    ).toBe("app");
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
