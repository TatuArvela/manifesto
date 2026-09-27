import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { offerLaunchImage } from "./launchImage.js";

// A solid black square, as the stock logo is a solid black shape.
const LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="black"/></svg>',
)}`;

let splash: HTMLElement;

function launchLinks() {
  return [
    ...document.querySelectorAll<HTMLLinkElement>(
      'link[rel="apple-touch-startup-image"]',
    ),
  ];
}

/** Safari's flag, which says whether the page is already a home-screen app. */
function setStandalone(value: boolean | undefined) {
  Object.defineProperty(navigator, "standalone", {
    value,
    configurable: true,
  });
}

async function pixel(src: string, x: number, y: number) {
  const image = new Image();
  image.src = src;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(image, 0, 0);
  return {
    width: image.naturalWidth,
    height: image.naturalHeight,
    rgb: [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)],
  };
}

beforeEach(() => {
  // index.html's splash, reduced to what places the logo and the name.
  splash = document.createElement("div");
  splash.id = "splash";
  splash.style.cssText =
    "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.9rem";
  splash.innerHTML = `<img src="${LOGO}" alt="" style="width:76px;height:76px" /><p style="margin:0;font-weight:600">Manifesto</p><div style="height:3px"></div>`;
  document.body.appendChild(splash);
});

afterEach(() => {
  splash.remove();
  for (const link of launchLinks()) link.remove();
  setStandalone(undefined);
});

describe("the launch image", () => {
  it("is offered in Safari, in both orientations and both schemes", async () => {
    setStandalone(false);
    offerLaunchImage(0);
    await expect.poll(() => launchLinks().length).toBe(4);
    expect(launchLinks().map((link) => link.media)).toEqual([
      "(orientation: portrait) and (prefers-color-scheme: light)",
      "(orientation: landscape) and (prefers-color-scheme: light)",
      "(orientation: portrait) and (prefers-color-scheme: dark)",
      "(orientation: landscape) and (prefers-color-scheme: dark)",
    ]);
    for (const link of launchLinks()) {
      expect(link.href.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  it("is the splash at the screen's full size, logo inverted in the dark", async () => {
    setStandalone(false);
    const logoBox = splash.querySelector("img")?.getBoundingClientRect();
    const box = splash.getBoundingClientRect();
    if (!logoBox) throw new Error("no logo");
    offerLaunchImage(0);
    await expect.poll(() => launchLinks().length).toBe(4);
    const [light, , dark] = launchLinks();

    const scale = window.devicePixelRatio;
    const width = Math.min(screen.width, screen.height);
    const height = Math.max(screen.width, screen.height);
    // The logo's centre, at the same distance from the screen's centre as it
    // is from the splash's.
    const x = Math.round(
      (width / 2 +
        logoBox.left +
        logoBox.width / 2 -
        (box.left + box.width / 2)) *
        scale,
    );
    const y = Math.round(
      (height / 2 +
        logoBox.top +
        logoBox.height / 2 -
        (box.top + box.height / 2)) *
        scale,
    );

    const lightLogo = await pixel(light.href, x, y);
    expect(lightLogo.width).toBe(Math.round(width * scale));
    expect(lightLogo.height).toBe(Math.round(height * scale));
    expect(lightLogo.rgb).toEqual([0, 0, 0]);
    expect((await pixel(light.href, 1, 1)).rgb).toEqual([255, 255, 255]);

    expect((await pixel(dark.href, x, y)).rgb).toEqual([255, 255, 255]);
    expect((await pixel(dark.href, 1, 1)).rgb).toEqual([0x17, 0x17, 0x17]);
  });

  it("is not drawn inside an app already on the home screen", async () => {
    setStandalone(true);
    offerLaunchImage(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(launchLinks()).toHaveLength(0);
  });

  it("is not drawn outside Safari", async () => {
    offerLaunchImage(0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(launchLinks()).toHaveLength(0);
  });
});
