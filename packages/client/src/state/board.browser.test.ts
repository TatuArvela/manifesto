import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { loadBoardImage } from "../storage/boardImage.js";
import {
  boardImageUrl,
  initBoardBackground,
  removeBoardImage,
  setBoardImage,
} from "./board.js";
import {
  boardColor,
  boardImageStamp,
  boardTexture,
  boardUsePicture,
} from "./prefs.js";
import { toasts } from "./ui.js";

/** A real, decodable picture, larger than the board keeps. */
async function photo(width: number, height: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = "#c0ffee";
  ctx.fillRect(0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  return new File([blob as Blob], "photo.png", { type: "image/png" });
}

const boardImageVar = () =>
  document.documentElement.style.getPropertyValue("--board-image");

describe("board picture", () => {
  let stop: () => void;

  beforeEach(() => {
    boardColor.value = "none";
    boardTexture.value = "none";
    boardUsePicture.value = false;
    boardImageStamp.value = 0;
    stop = initBoardBackground();
  });

  afterEach(async () => {
    await removeBoardImage();
    stop();
    boardColor.value = "none";
    boardTexture.value = "none";
    toasts.value = [];
  });

  it("keeps a shrunk copy on the device and paints it on the board", async () => {
    await expect(setBoardImage(await photo(4000, 1000))).resolves.toBe(true);

    expect(boardUsePicture.value).toBe(true);
    const stored = await loadBoardImage();
    const decoded = await createImageBitmap(stored as Blob);
    expect(decoded.width).toBe(2560);
    expect(decoded.height).toBe(640);
    await vi.waitFor(() => expect(boardImageVar()).toContain("blob:"));
    expect(document.documentElement.dataset.boardPicture).toBe("");
  });

  it("gives the board back to the composition when set aside, and keeps it on offer", async () => {
    boardColor.value = "sage";
    boardTexture.value = "dots";
    await setBoardImage(await photo(40, 40));
    await vi.waitFor(() => expect(boardImageVar()).toContain("blob:"));

    boardUsePicture.value = false;

    expect(boardImageVar()).toBe("");
    expect(document.documentElement.dataset.boardPicture).toBeUndefined();
    expect(boardImageUrl.value).toContain("blob:");
    expect(document.documentElement.dataset.boardColor).toBe("sage");
    expect(document.documentElement.dataset.boardTexture).toBe("dots");
  });

  it("forgets it on removal, leaving the composition", async () => {
    boardTexture.value = "grid";
    await setBoardImage(await photo(40, 40));
    await vi.waitFor(() => expect(boardImageUrl.value).not.toBeNull());

    await expect(removeBoardImage()).resolves.toBe(true);

    expect(boardUsePicture.value).toBe(false);
    expect(await loadBoardImage()).toBeNull();
    expect(boardImageUrl.value).toBeNull();
    expect(boardTexture.value).toBe("grid");
  });

  it("says so, and changes nothing, when the file is not a picture", async () => {
    const text = new File(["not a picture"], "notes.png", {
      type: "image/png",
    });

    await expect(setBoardImage(text)).resolves.toBe(false);

    expect(boardUsePicture.value).toBe(false);
    expect(toasts.value.at(-1)?.message).toBe(
      t("settings.boardBackground.unreadable"),
    );
  });
});
