import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "#/styles.css";
import { t } from "#/i18n/index.ts";
import {
  animations,
  boardColor,
  boardCustomColor,
  boardGradient,
  boardGradientDirection,
  boardGradientSpeed,
  boardTexture,
  boardTextureMotion,
  boardTextureOpacity,
  boardUsePicture,
  resolvedBoardTexture,
} from "#/state/prefs.ts";
import { BoardBackgroundSettings } from "./BoardBackgroundSettings.tsx";

let host: HTMLDivElement;
let board: HTMLElement;

const nextFrame = () =>
  new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (el) =>
      el.getAttribute("aria-label") === label ||
      el.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button for ${label}`);
  return found;
}

beforeEach(() => {
  boardColor.value = "none";
  boardTexture.value = "none";
  boardUsePicture.value = false;
  host = document.createElement("div");
  board = document.createElement("div");
  board.className = "board-frame";
  // The board fades between colors. Read its final value, not the fade.
  board.style.transition = "none";
  document.body.append(host, board);
  render(<BoardBackgroundSettings />, host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  board.remove();
  boardColor.value = "none";
  boardTexture.value = "none";
  boardTextureOpacity.value = 10;
  document.documentElement.classList.remove("dark");
});

describe("board motion", () => {
  const root = document.documentElement;

  afterEach(() => {
    animations.value = true;
    boardGradient.value = "none";
    boardGradientSpeed.value = "still";
    boardTextureMotion.value = false;
  });

  it("rolls the gradient on a layer, at the chosen speed", async () => {
    animations.value = true;
    boardGradient.value = "blue";
    boardGradientDirection.value = "right";
    await nextFrame();
    button(t("settings.boardBackground.speed.fast")).click();
    await nextFrame();

    expect(root.dataset.boardRoll).toBe("fast");
    const layer = getComputedStyle(board, "::after");
    expect(layer.getPropertyValue("animation-name")).toBe("board-roll");
    expect(layer.getPropertyValue("animation-duration")).toBe("20s");
    // Three boards wide, one board high, for a gradient that goes sideways.
    expect(Number.parseFloat(layer.width)).toBeCloseTo(
      board.getBoundingClientRect().width * 3,
    );
    expect(Number.parseFloat(layer.height)).toBeCloseTo(
      board.getBoundingClientRect().height,
    );
  });

  it("has no speed to change with no gradient", async () => {
    animations.value = true;
    boardGradient.value = "none";
    boardGradientSpeed.value = "fast";
    await nextFrame();
    expect(root.dataset.boardRoll).toBeUndefined();
    expect(
      button(t("settings.boardBackground.speed.fast")).matches(":disabled"),
    ).toBe(true);
  });

  it("moves the pattern past the edge of its layer", async () => {
    animations.value = true;
    boardTexture.value = "confetti";
    boardTextureMotion.value = true;
    await nextFrame();

    const layer = getComputedStyle(board, "::before");
    expect(layer.getPropertyValue("animation-name")).toBe(
      "board-texture-drift, board-texture-sway",
    );
    expect(layer.getPropertyValue("top")).toBe("-332px");
    expect(getComputedStyle(board).getPropertyValue("overflow-x")).toBe("clip");
  });

  it("holds the board still with the animations off", async () => {
    boardGradient.value = "blue";
    boardGradientSpeed.value = "fast";
    boardTexture.value = "dots";
    boardTextureMotion.value = true;
    animations.value = false;
    await nextFrame();

    expect(root.dataset.boardRoll).toBeUndefined();
    expect(root.dataset.boardTextureMotion).toBeUndefined();
    expect(getComputedStyle(board, "::before").getPropertyValue("top")).toBe(
      "0px",
    );
    expect(host.textContent).toContain(t("settings.boardBackground.motionOff"));
    // The choices stay. Thus, the board moves again with the animations on.
    animations.value = true;
    await nextFrame();
    expect(root.dataset.boardRoll).toBe("fast");
    expect(root.dataset.boardTextureMotion).toBe("");
  });
});

describe("board background composer", () => {
  it("puts the chosen colour and texture on the board together", async () => {
    button(t("color.green")).click();
    button(t("settings.boardBackground.texture.dots")).click();
    await nextFrame();

    const style = getComputedStyle(board);
    const layer = getComputedStyle(board, "::before");
    const green = getComputedStyle(document.documentElement)
      .getPropertyValue("--board-green")
      .trim();
    expect(boardColor.value).toBe("green");
    expect(boardTexture.value).toBe("dots");
    expect(layer.getPropertyValue("mask-image")).toContain("radial-gradient");
    // Hex in the stylesheet, rgb after computation.
    const probe = document.createElement("span");
    probe.style.color = green;
    document.body.appendChild(probe);
    expect(style.backgroundColor).toBe(getComputedStyle(probe).color);
    probe.remove();
  });

  it("changes only the texture layer's opacity with the slider", async () => {
    button(t("settings.boardBackground.texture.stars")).click();
    await nextFrame();
    const layer = () => getComputedStyle(board, "::before");
    const mask = layer().getPropertyValue("mask-image");
    expect(mask).toContain("data:image/svg+xml");
    const slider = host.querySelector<HTMLInputElement>('input[type="range"]');
    if (!slider) throw new Error("no opacity slider");
    slider.value = "25";
    slider.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await nextFrame();
    expect(boardTextureOpacity.value).toBe(25);
    expect(layer().opacity).toBe("0.25");
    // The same drawing: the slider never draws a texture again.
    expect(layer().getPropertyValue("mask-image")).toBe(mask);
  });

  it("deepens a custom colour in the dark theme rather than using it as picked", async () => {
    boardCustomColor.value = "#ffcc00";
    const picker = host.querySelector<HTMLInputElement>('input[type="color"]');
    if (!picker) throw new Error("no colour picker");
    picker.value = "#ffcc00";
    picker.dispatchEvent(new InputEvent("input", { bubbles: true }));
    await nextFrame();
    expect(boardColor.value).toBe("custom");
    expect(getComputedStyle(board).backgroundColor).toBe("rgb(255, 204, 0)");

    document.documentElement.classList.add("dark");
    await nextFrame();

    const dark = getComputedStyle(board).backgroundColor;
    expect(dark).not.toBe("rgb(255, 204, 0)");
    // Sufficiently dark that the notes on it, which are also dark, are clear.
    const channels =
      dark
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number) ?? [];
    expect(Math.max(...channels)).toBeLessThan(120);
  });

  it("sets the picture aside when a colour or texture is chosen", () => {
    boardUsePicture.value = true;

    button(t("settings.boardBackground.texture.grid")).click();

    expect(boardUsePicture.value).toBe(false);
    expect(boardTexture.value).toBe("grid");
  });

  it("picks again for every random choice from one button, shown only while there is one", async () => {
    expect(() => button(t("settings.boardBackground.reroll"))).toThrow();

    boardTexture.value = "random";
    await nextFrame();
    const before = resolvedBoardTexture.value;
    button(t("settings.boardBackground.reroll")).click();

    expect(boardTexture.value).toBe("random");
    expect(resolvedBoardTexture.value).not.toBe(before);
  });
});
