/**
 * Gives iOS a picture of the loading screen to show while a home-screen launch
 * starts up.
 *
 * Launched from the home screen, iOS shows a blank screen until the page
 * arrives, and nothing in the page can draw there: the only thing iOS puts up
 * in that time is an `apple-touch-startup-image`, which it takes when the app
 * is added to the home screen. So the page draws one, in Safari, from the
 * splash in index.html as it stands: the same logo, name and layout, at this
 * device's exact size (iOS ignores an image of any other size), with the
 * system font. Being drawn from the served page, it follows a rebranded
 * bundle's files with no build step.
 *
 * One image per orientation and system scheme. A home-screen app keeps its
 * own storage apart from Safari's, so it starts on the system theme whatever
 * the theme preference in Safari says, and the scheme is all that can differ.
 */

/** The splash's two themes, as index.html spells them. */
const THEMES = {
  light: { background: "#ffffff", text: "#171717", invertLogo: false },
  dark: { background: "#171717", text: "#fafafa", invertLogo: true },
} as const;

type Theme = (typeof THEMES)[keyof typeof THEMES];

/** Where the splash puts its logo and name, from the centre of the screen. */
interface SplashLayout {
  logoSrc: string;
  logo: { dx: number; dy: number; width: number; height: number };
  name: { text: string; dy: number; font: string; letterSpacing: string };
}

/**
 * Only Safari on iOS and iPadOS has `navigator.standalone`, and it is true
 * inside an app already on the home screen, which has no use for the image.
 */
function canBeAddedToHomeScreen(): boolean {
  const standalone = (navigator as { standalone?: boolean }).standalone;
  return standalone === false;
}

/**
 * Reads the splash's layout. Called at boot, while the splash is still there;
 * it is removed once the app is up.
 */
function measureSplash(): SplashLayout | null {
  const splash = document.getElementById("splash");
  const logo = splash?.querySelector("img");
  const name = splash?.querySelector("p");
  if (!splash || !logo || !name) return null;
  const box = splash.getBoundingClientRect();
  const centreX = box.left + box.width / 2;
  const centreY = box.top + box.height / 2;
  const logoBox = logo.getBoundingClientRect();
  const nameBox = name.getBoundingClientRect();
  const style = getComputedStyle(name);
  return {
    logoSrc: logo.src,
    logo: {
      dx: logoBox.left - centreX,
      dy: logoBox.top - centreY,
      width: logoBox.width,
      height: logoBox.height,
    },
    name: {
      text: name.textContent ?? "",
      dy: nameBox.top + nameBox.height / 2 - centreY,
      font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      letterSpacing: style.letterSpacing,
    },
  };
}

/**
 * The logo as the dark splash shows it, `filter: invert(1)`, done with
 * compositing because Safari's canvas has no `filter`: white made the
 * difference of every pixel, then cut back to the logo's own shape.
 */
function invertedLogo(logo: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return logo;
  ctx.drawImage(logo, 0, 0, width, height);
  ctx.globalCompositeOperation = "difference";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(logo, 0, 0, width, height);
  return canvas;
}

function drawLaunchImage(
  layout: SplashLayout,
  logo: HTMLImageElement,
  theme: Theme,
  width: number,
  height: number,
  scale: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  const { dx, dy, width: w, height: h } = layout.logo;
  const mark = theme.invertLogo
    ? invertedLogo(logo, Math.round(w * scale), Math.round(h * scale))
    : logo;
  ctx.drawImage(mark, width / 2 + dx, height / 2 + dy, w, h);

  ctx.font = layout.name.font;
  if ("letterSpacing" in ctx) ctx.letterSpacing = layout.name.letterSpacing;
  ctx.fillStyle = theme.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(layout.name.text, width / 2, height / 2 + layout.name.dy);
  return canvas.toDataURL("image/png");
}

function addLink(href: string, media: string) {
  const link = document.createElement("link");
  link.rel = "apple-touch-startup-image";
  link.href = href;
  link.media = media;
  document.head.appendChild(link);
}

/**
 * Draws the launch images and puts them in the page. The work is a few large
 * PNG encodes, so it waits until the app is up rather than competing with it.
 */
export function offerLaunchImage(delayMs = 3000): void {
  if (!canBeAddedToHomeScreen()) return;
  const layout = measureSplash();
  if (!layout) return;
  setTimeout(() => void addLaunchImages(layout), delayMs);
}

async function addLaunchImages(layout: SplashLayout): Promise<void> {
  const logo = new Image();
  logo.src = layout.logoSrc;
  try {
    await logo.decode();
  } catch {
    return;
  }
  // `screen` is the whole display in CSS pixels, and on iOS always the
  // portrait way round.
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const scale = window.devicePixelRatio || 1;
  for (const [scheme, theme] of Object.entries(THEMES)) {
    for (const [orientation, width, height] of [
      ["portrait", short, long],
      ["landscape", long, short],
    ] as const) {
      try {
        const image = drawLaunchImage(
          layout,
          logo,
          theme,
          width,
          height,
          scale,
        );
        if (!image) continue;
        addLink(
          image,
          `(orientation: ${orientation}) and (prefers-color-scheme: ${scheme})`,
        );
      } catch {
        // A canvas the logo tainted cannot be exported; iOS then shows its
        // blank screen, as it did before.
      }
    }
  }
}
