import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../styles.css";
import { t } from "../i18n/index.js";
import {
  boardColor,
  boardCustomColor,
  boardTexture,
  boardUsePicture,
} from "../state/index.js";
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
  board = document.createElement("main");
  board.className = "board";
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
  document.documentElement.classList.remove("dark");
});

describe("board background composer", () => {
  it("puts the chosen colour and texture on the board together", async () => {
    button(t("settings.boardBackground.sage")).click();
    button(t("settings.boardBackground.texture.dots")).click();
    await nextFrame();

    const style = getComputedStyle(board);
    const sage = getComputedStyle(document.documentElement)
      .getPropertyValue("--board-sage")
      .trim();
    expect(boardColor.value).toBe("sage");
    expect(boardTexture.value).toBe("dots");
    expect(style.backgroundImage).toContain("radial-gradient");
    // Hex in the stylesheet, rgb once computed.
    const probe = document.createElement("span");
    probe.style.color = sage;
    document.body.appendChild(probe);
    expect(style.backgroundColor).toBe(getComputedStyle(probe).color);
    probe.remove();
    expect(
      button(
        `${t("settings.boardBackground")}: ${t("settings.boardBackground.summary", { color: t("settings.boardBackground.sage"), texture: t("settings.boardBackground.texture.dots") })}`,
      ),
    ).toBeTruthy();
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
