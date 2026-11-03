import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "#/styles.css";
import { BoardSheets, MovingBoard } from "#/components/BoardLayers.tsx";
import { t } from "#/i18n/index.ts";
import {
  animations,
  boardColor,
  boardCustomColor,
  boardGradient,
  boardGradientDirection,
  boardGradientSpeed,
  boardTexture,
  boardTextureOpacity,
  boardTextureSpeed,
  boardUsePicture,
  resolvedBoardTexture,
} from "#/state/prefs.ts";
import { defined } from "#/test/defined.ts";
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
    render(null, board);
    animations.value = true;
    boardGradient.value = "none";
    boardGradientSpeed.value = 0;
    boardTextureSpeed.value = 0;
  });

  function slider(label: string): HTMLInputElement {
    const found = host.querySelector<HTMLInputElement>(
      `input[aria-label="${label}"]`,
    );
    if (!found) throw new Error(`no slider for ${label}`);
    return found;
  }

  function slide(label: string, value: number) {
    const input = slider(label);
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function boardAnimation(name: string): CSSAnimation {
    const found = document
      .getAnimations()
      .find(
        (animation): animation is CSSAnimation =>
          animation instanceof CSSAnimation && animation.animationName === name,
      );
    if (!found) throw new Error(`no animation ${name}`);
    return found;
  }

  /** The sheets of the pattern, in the frame of the test, as App puts them. */
  function mountLayers() {
    render(<BoardSheets texture={resolvedBoardTexture.value} />, board);
  }

  it("rolls the gradient on a layer, at the speed of the slider", async () => {
    boardGradient.value = "blue";
    boardGradientDirection.value = "right";
    await nextFrame();
    slide(t("settings.boardBackground.speed"), 200);
    mountLayers();
    await nextFrame();
    await nextFrame();

    expect(root.dataset.boardRoll).toBe("");
    const layer = getComputedStyle(board, "::after");
    expect(layer.getPropertyValue("animation-name")).toBe("board-roll");
    // A repeat of two boards, and one board more, for a gradient that goes
    // sideways. One board high.
    expect(Number.parseFloat(layer.width)).toBeCloseTo(
      board.getBoundingClientRect().width * 3,
    );
    expect(Number.parseFloat(layer.height)).toBeCloseTo(
      board.getBoundingClientRect().height,
    );
    expect(boardAnimation("board-roll").playbackRate).toBe(2);
  });

  // A new duration would put the layer at a new point of its loop.
  it("keeps the layer where it is when the speed changes", async () => {
    boardGradient.value = "blue";
    boardGradientSpeed.value = 100;
    await nextFrame();
    await nextFrame();
    const roll = boardAnimation("board-roll");
    roll.currentTime = 30_000;
    slide(t("settings.boardBackground.speed"), 50);

    expect(roll.playbackRate).toBe(0.5);
    expect(Number(roll.currentTime)).toBeCloseTo(30_000, -2);
    // Two boards, one each 30 s.
    expect(getComputedStyle(board, "::after").animationDuration).toBe("60s");
  });

  it("has no speed to change with no gradient", async () => {
    boardGradient.value = "none";
    boardGradientSpeed.value = 100;
    await nextFrame();
    expect(root.dataset.boardRoll).toBeUndefined();
    expect(slider(t("settings.boardBackground.speed")).disabled).toBe(true);
  });

  it("moves the pattern in its sheets, past the edge that they come from", async () => {
    boardTexture.value = "confetti";
    await nextFrame();
    slide(t("settings.boardBackground.patternSpeed"), 100);
    mountLayers();
    await nextFrame();

    const sheets = board.querySelectorAll(".board-sheets > span");
    expect(sheets).toHaveLength(3);
    const first = getComputedStyle(defined(sheets[0]));
    expect(first.animationName).toBe("board-sheet-drift, board-sheet-sway");
    // It falls by one tile. Thus, it starts one tile above the board.
    expect(first.top).toBe("-320px");
    expect(first.bottom).toBe("0px");
    expect(getComputedStyle(board, "::before").display).toBe("none");
    expect(getComputedStyle(board).getPropertyValue("overflow-x")).toBe("clip");
    // The tile of the pattern moves too.
    const tile = button(t("settings.boardBackground.texture.confetti"));
    expect(tile.querySelectorAll(".board-sheets > span")).toHaveLength(3);
  });

  it("paints the moving pattern of the board on one canvas", async () => {
    boardTexture.value = "waves";
    boardTextureSpeed.value = 100;
    render(<MovingBoard texture={resolvedBoardTexture.value} />, board);
    await nextFrame();

    // One layer, not a sheet for each row of waves.
    expect(board.querySelectorAll(".board-canvas > canvas")).toHaveLength(1);
    expect(board.querySelector(".board-sheets")).toBeNull();
    // The painter gives the marks their opacity, not the layer.
    const layer = defined(
      board.querySelector<HTMLElement>(".board-canvas") ?? undefined,
    );
    expect(getComputedStyle(layer).opacity).toBe("1");
    expect(layer.dataset.roll).toBeUndefined();
    expect(getComputedStyle(board, "::before").display).toBe("none");
  });

  it("paints the rolling gradient on the canvas, under the still pattern", async () => {
    boardGradient.value = "blue";
    boardGradientSpeed.value = 100;
    boardTexture.value = "dots";
    render(<MovingBoard texture={resolvedBoardTexture.value} />, board);
    await nextFrame();

    const layer = defined(
      board.querySelector<HTMLElement>(".board-canvas") ?? undefined,
    );
    expect(layer.dataset.roll).toBe("");
    // The painter draws the gradient. Thus, the CSS roll does not show.
    expect(getComputedStyle(board, "::after").display).toBe("none");
    // The still dots show over it.
    expect(getComputedStyle(board, "::before").display).not.toBe("none");
    expect(Number(getComputedStyle(layer).zIndex)).toBeLessThan(
      Number(getComputedStyle(board, "::before").zIndex),
    );
    // The page reads the colors from the canvas itself, not from its layer.
    const canvas = defined(
      layer.querySelector<HTMLCanvasElement>("canvas") ?? undefined,
    );
    const page = getComputedStyle(document.documentElement)
      .getPropertyValue("--board-page")
      .trim();
    const blue = getComputedStyle(document.documentElement)
      .getPropertyValue("--board-blue")
      .trim();
    const probe = document.createElement("span");
    document.body.appendChild(probe);
    const resolved = (color: string) => {
      probe.style.color = color;
      return getComputedStyle(probe).color;
    };
    const style = getComputedStyle(canvas);
    expect(style.borderTopColor).toBe(resolved(page));
    expect(style.borderBottomColor).toBe(resolved(blue));
    expect(style.borderBottomColor).not.toBe(style.color);
    probe.remove();
  });

  it("paints nothing with the pattern still", async () => {
    boardTexture.value = "waves";
    boardTextureSpeed.value = 0;
    render(<MovingBoard texture={resolvedBoardTexture.value} />, board);
    await nextFrame();
    expect(board.querySelector(".board-canvas")).toBeNull();
  });

  it("holds the board still with the animations off", async () => {
    boardGradient.value = "blue";
    boardGradientSpeed.value = 200;
    boardTexture.value = "dots";
    boardTextureSpeed.value = 100;
    animations.value = false;
    mountLayers();
    await nextFrame();

    expect(root.dataset.boardRoll).toBeUndefined();
    expect(root.dataset.boardTextureMotion).toBeUndefined();
    expect(board.querySelector(".board-sheets")).toBeNull();
    expect(getComputedStyle(board, "::before").display).not.toBe("none");
    expect(host.textContent).toContain(t("settings.boardBackground.motionOff"));
    // The choices stay. Thus, the board moves again with the animations on.
    animations.value = true;
    await nextFrame();
    expect(root.dataset.boardRoll).toBe("");
    expect(root.dataset.boardTextureMotion).toBe("");
    // The dots roll in one sheet, from the top left.
    const sheets = board.querySelectorAll(".board-sheets > span");
    expect(sheets).toHaveLength(1);
    const sheet = getComputedStyle(defined(sheets[0]));
    expect(sheet.animationName).toBe("board-sheet-drift");
    expect([sheet.left, sheet.top]).toEqual(["-22px", "-22px"]);
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
