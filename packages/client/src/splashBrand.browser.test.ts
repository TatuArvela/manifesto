import { afterEach, beforeEach, describe, expect, it } from "vitest";

// What `public/splash-brand.js` draws again: the splash of index.html as it is
// before the script runs, and the branding meta tags that the script reads.
const BRAND_TAGS = [
  "application-name",
  "app-logo",
  "app-logo-dark",
  "instance-name",
  "instance-logo",
  "instance-logo-dark",
  "header-brand",
];

let splash: HTMLElement;

function setMeta(tags: Record<string, string>) {
  for (const [name, content] of Object.entries(tags)) {
    const tag = document.createElement("meta");
    tag.name = name;
    tag.content = content;
    document.head.appendChild(tag);
  }
}

/** Runs the script as index.html does, from the own origin of the page. */
async function brandSplash() {
  const script = document.createElement("script");
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = reject;
    script.src = "/splash-brand.js";
    document.body.appendChild(script);
  });
  script.remove();
}

function images() {
  return [...splash.querySelectorAll("img")].map((image) => ({
    src: new URL(image.src).pathname,
    attrs: image
      .getAttributeNames()
      .filter((name) => name.startsWith("data-"))
      .sort(),
  }));
}

function lines() {
  return [...splash.querySelectorAll("p")].map((line) => ({
    text: line.textContent,
    secondary: line.hasAttribute("data-secondary"),
  }));
}

beforeEach(() => {
  splash = document.createElement("div");
  splash.id = "splash";
  splash.innerHTML = `<img src="/logo.svg" alt="" data-invert /><p>Manifesto</p><div></div>`;
  document.body.appendChild(splash);
});

afterEach(() => {
  splash.remove();
  for (const name of BRAND_TAGS) {
    for (const tag of document.querySelectorAll(`meta[name="${name}"]`)) {
      tag.remove();
    }
  }
});

describe("the loading screen's brand", () => {
  it("stays the app's when nothing is set, placeholders included", async () => {
    setMeta({
      "application-name": "Manifesto",
      "app-logo": "logo.svg",
      "instance-name": "%INSTANCE_NAME%",
      "header-brand": "app",
    });
    await brandSplash();
    expect(images()).toEqual([{ src: "/logo.svg", attrs: ["data-invert"] }]);
    expect(lines()).toEqual([{ text: "Manifesto", secondary: false }]);
    expect(splash.lastElementChild?.tagName).toBe("DIV");
  });

  it("names the instance under the app's name", async () => {
    setMeta({
      "application-name": "Corporate Notes",
      "app-logo": "app-logo.svg",
      "instance-name": "Foo QA project",
      "header-brand": "app",
    });
    await brandSplash();
    expect(images()).toEqual([
      { src: "/app-logo.svg", attrs: ["data-invert"] },
    ]);
    expect(lines()).toEqual([
      { text: "Corporate Notes", secondary: false },
      { text: "Foo QA project", secondary: true },
    ]);
  });

  it("is the instance's logo and name when the top bar is", async () => {
    setMeta({
      "application-name": "Manifesto",
      "instance-name": "Foo QA project",
      "instance-logo": "instance-logo.svg",
      "instance-logo-dark": "instance-logo-dark.svg",
      "header-brand": "instance",
    });
    await brandSplash();
    expect(images()).toEqual([
      { src: "/instance-logo.svg", attrs: ["data-light", "data-wide"] },
      { src: "/instance-logo-dark.svg", attrs: ["data-dark", "data-wide"] },
    ]);
    expect(lines()).toEqual([{ text: "Foo QA project", secondary: false }]);
  });

  it("is the instance's name alone when it has no logo", async () => {
    setMeta({
      "instance-name": "Foo QA project",
      "header-brand": "instance",
    });
    await brandSplash();
    expect(images()).toEqual([]);
    expect(lines()).toEqual([{ text: "Foo QA project", secondary: false }]);
  });

  it("stays the app's when the instance brand has no instance name", async () => {
    setMeta({ "application-name": "Manifesto", "header-brand": "instance" });
    await brandSplash();
    expect(images()).toEqual([{ src: "/logo.svg", attrs: ["data-invert"] }]);
    expect(lines()).toEqual([{ text: "Manifesto", secondary: false }]);
  });
});
