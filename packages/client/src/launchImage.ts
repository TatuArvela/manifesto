/**
 * Gives iOS a picture of the loading screen to show while a home-screen launch
 * starts.
 *
 * When an app starts from the home screen, iOS shows a blank screen until the
 * page arrives, and nothing in the page can draw there. The only item that iOS
 * shows in that time is an `apple-touch-startup-image`, which it takes when the
 * app is added to the home screen. Thus, the page draws one in Safari, from the
 * current splash in index.html: the same logo, names and layout, at the exact
 * size of this device (iOS ignores an image of any other size), with the system
 * font. It is drawn from the served page, after `splash-brand.js` put the brand
 * of the deployment on it. Thus, it follows the files of a rebranded bundle
 * with no build step.
 *
 * One image for each orientation and system scheme. A home-screen app keeps its
 * own storage, separate from that of Safari. Thus, it starts on the system
 * theme, whatever the theme preference in Safari says, and only the scheme can
 * be different.
 */

/** The two themes of the splash, as index.html writes them. */
const THEMES = {
  light: {
    dark: false,
    background: "#ffffff",
    text: "#171717",
    secondary: "#525252",
  },
  dark: {
    dark: true,
    background: "#171717",
    text: "#fafafa",
    secondary: "#a3a3a3",
  },
} as const;

type Theme = (typeof THEMES)[keyof typeof THEMES];

/** A line of text on the splash, positioned from the center of the screen. */
interface SplashLine {
  text: string;
  dy: number;
  font: string;
  letterSpacing: string;
  secondary: boolean;
}

/**
 * Where the splash puts its logo and names, from the center of the screen.
 * The logo is the light one and, if it has one, its dark variant. Both use the
 * same box. Without a dark variant, the logo of the app is inverted in the
 * dark.
 */
interface SplashLayout {
  logo: {
    light: string;
    dark: string | null;
    invertInDark: boolean;
    dx: number;
    dy: number;
    width: number;
    height: number;
  } | null;
  lines: SplashLine[];
}

/**
 * Only Safari on iOS and iPadOS has `navigator.standalone`. It is true inside
 * an app that is already on the home screen, which does not need the image.
 */
function canBeAddedToHomeScreen(): boolean {
  const standalone = (navigator as { standalone?: boolean }).standalone;
  return standalone === false;
}

/**
 * Reads the layout of the splash. Called at start, while the splash is still
 * there. It is removed after the app is up.
 */
function measureSplash(): SplashLayout | null {
  const splash = document.getElementById("splash");
  if (!splash) return null;
  const box = splash.getBoundingClientRect();
  const centreX = box.left + box.width / 2;
  const centreY = box.top + box.height / 2;

  const images = [...splash.querySelectorAll("img")];
  const light = images.find((image) => !image.hasAttribute("data-dark"));
  const dark = images.find((image) => image.hasAttribute("data-dark"));
  // Only the variant that the current theme shows has a box. Both variants use
  // the same box.
  const shown = images.find((image) => image.getBoundingClientRect().width);
  const logoBox = shown?.getBoundingClientRect();

  const lines = [...splash.querySelectorAll("p")].map((line) => {
    const lineBox = line.getBoundingClientRect();
    const style = getComputedStyle(line);
    return {
      text: line.textContent ?? "",
      dy: lineBox.top + lineBox.height / 2 - centreY,
      font: `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      letterSpacing: style.letterSpacing,
      secondary: line.hasAttribute("data-secondary"),
    };
  });
  if (!lines.length) return null;
  return {
    logo:
      light && logoBox
        ? {
            light: light.src,
            dark: dark?.src ?? null,
            invertInDark: light.hasAttribute("data-invert"),
            dx: logoBox.left - centreX,
            dy: logoBox.top - centreY,
            width: logoBox.width,
            height: logoBox.height,
          }
        : null,
    lines,
  };
}

/**
 * Where `object-fit: contain` puts an image in its box. A wide logo that the
 * maximum width of the splash limits gets empty bands, and is not compressed.
 * An image that has no size of its own fills the box.
 */
function contain(
  image: HTMLImageElement,
  box: { x: number; y: number; width: number; height: number },
) {
  const { naturalWidth, naturalHeight } = image;
  if (!naturalWidth || !naturalHeight) return box;
  const ratio = Math.min(box.width / naturalWidth, box.height / naturalHeight);
  const width = naturalWidth * ratio;
  const height = naturalHeight * ratio;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * The logo as the dark splash shows it, `filter: invert(1)`, made with
 * compositing, because the canvas of Safari has no `filter`: white is made the
 * difference of each pixel, then cut back to the own shape of the logo.
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
  logos: { light: HTMLImageElement | null; dark: HTMLImageElement | null },
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

  const logo = (theme.dark && logos.dark) || logos.light;
  if (layout.logo && logo) {
    const { dx, dy } = layout.logo;
    const at = contain(logo, {
      x: width / 2 + dx,
      y: height / 2 + dy,
      width: layout.logo.width,
      height: layout.logo.height,
    });
    const mark =
      theme.dark && !logos.dark && layout.logo.invertInDark
        ? invertedLogo(
            logo,
            Math.round(at.width * scale),
            Math.round(at.height * scale),
          )
        : logo;
    ctx.drawImage(mark, at.x, at.y, at.width, at.height);
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const line of layout.lines) {
    ctx.font = line.font;
    if ("letterSpacing" in ctx) ctx.letterSpacing = line.letterSpacing;
    ctx.fillStyle = line.secondary ? theme.secondary : theme.text;
    ctx.fillText(line.text, width / 2, height / 2 + line.dy);
  }
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
 * Draws the launch images, and puts them in the page. The work is a few large
 * PNG encodes. Thus, it waits until the app is up, and does not compete with
 * it.
 */
export function offerLaunchImage(delayMs = 3000): void {
  if (!canBeAddedToHomeScreen()) return;
  const layout = measureSplash();
  if (!layout) return;
  setTimeout(() => void addLaunchImages(layout), delayMs);
}

/**
 * A decoded logo, ready to draw. Null if there is no logo, or if it did not
 * load.
 */
async function loadLogo(src: string | null | undefined) {
  if (!src) return null;
  const image = new Image();
  image.src = src;
  try {
    await image.decode();
    return image;
  } catch {
    return null;
  }
}

async function addLaunchImages(layout: SplashLayout): Promise<void> {
  const logos = {
    light: await loadLogo(layout.logo?.light),
    dark: await loadLogo(layout.logo?.dark),
  };
  // If a logo does not load, iOS shows its blank screen, as before. A splash
  // without its mark is not drawn.
  if (layout.logo && !logos.light) return;
  // `screen` is the full display in CSS pixels, and on iOS always in portrait
  // orientation.
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
          logos,
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
        // A canvas that the logo tainted cannot be exported. iOS then shows its
        // blank screen, as before.
      }
    }
  }
}
