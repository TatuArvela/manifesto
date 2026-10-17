import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../styles.css";
import { t } from "../../i18n/index.js";
import {
  boardColor,
  boardCustomColor,
  boardTexture,
  boardTextureOpacity,
  boardUsePicture,
} from "../../state/prefs.js";
import { BoardBackgroundSetting } from "./BoardBackgroundSetting.js";

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

beforeEach(async () => {
  boardColor.value = "none";
  boardTexture.value = "none";
  boardUsePicture.value = false;
  host = document.createElement("div");
  board = document.createElement("div");
  board.className = "board-frame";
  // The board fades between colours; read where it lands, not the fade.
  board.style.transition = "none";
  document.body.append(host, board);
  render(<BoardBackgroundSetting />, host);
  button(
    `${t("settings.boardBackground")}: ${t("settings.boardBackground.none")}`,
  ).click();
  await nextFrame();
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
    // Hex in the stylesheet, rgb once computed.
    const probe = document.createElement("span");
    probe.style.color = green;
    document.body.appendChild(probe);
    expect(style.backgroundColor).toBe(getComputedStyle(probe).color);
    probe.remove();
    expect(
      button(
        `${t("settings.boardBackground")}: ${t("settings.boardBackground.summary", { color: t("color.green"), texture: t("settings.boardBackground.texture.dots") })}`,
      ),
    ).toBeTruthy();
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
    // The same drawing: the slider never redraws a texture.
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
    // Dark enough that the notes on it, dark themselves, stand out.
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
});
