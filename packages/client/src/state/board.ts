import { effect, signal } from "@preact/signals";
import { t } from "../i18n/index.js";
import {
  deleteBoardImage,
  loadBoardImage,
  saveBoardImage,
  shrinkBoardImage,
} from "../storage/boardImage.js";
import { boardImageStamp, boardUsePicture } from "./prefs.js";
import { showError } from "./ui.js";

/**
 * An object URL for the board picture on file, or null with none. Kept while
 * the colour and texture are showing too, so Settings can offer the picture.
 */
export const boardImageUrl = signal<string | null>(null);

let started = false;

/**
 * Loads the board picture whenever one is put on file, here or in another tab
 * (its stamp changes in the shared preferences), and paints it over the whole
 * board while it is in use. Called once from `App`.
 */
export function initBoardBackground(): () => void {
  if (started) return () => {};
  started = true;
  let generation = 0;

  const setUrl = (url: string | null) => {
    const previous = boardImageUrl.peek();
    boardImageUrl.value = url;
    if (previous) URL.revokeObjectURL(previous);
  };

  const stopLoading = effect(() => {
    const stamp = boardImageStamp.value;
    const mine = ++generation;
    if (stamp === 0) {
      setUrl(null);
      return;
    }
    void loadBoardImage()
      .catch(() => null)
      .then((blob) => {
        // Replaced again while this one was loading.
        if (mine !== generation) return;
        setUrl(blob ? URL.createObjectURL(blob) : null);
      });
  });

  // Keyed on the picture having loaded, not only on it being wanted: until
  // then, and if it never does, the colour and texture stay on the board
  // rather than a blank.
  const stopPainting = effect(() => {
    const url = boardImageUrl.value;
    const root = document.documentElement;
    if (url && boardUsePicture.value) {
      root.style.setProperty("--board-image", `url("${url}")`);
      root.dataset.boardPicture = "";
    } else {
      root.style.removeProperty("--board-image");
      delete root.dataset.boardPicture;
    }
  });

  return () => {
    stopLoading();
    stopPainting();
    generation++;
    setUrl(null);
    document.documentElement.style.removeProperty("--board-image");
    delete document.documentElement.dataset.boardPicture;
    started = false;
  };
}

/**
 * Makes `file` the board picture and shows it. Reports its own failure and
 * resolves false, like the actions in actions.ts.
 */
export async function setBoardImage(file: File): Promise<boolean> {
  const image = await shrinkBoardImage(file);
  if (!image) {
    showError(t("settings.boardBackground.unreadable"));
    return false;
  }
  try {
    await saveBoardImage(image);
  } catch {
    showError(t("settings.boardBackground.saveFailed"));
    return false;
  }
  boardImageStamp.value = Date.now();
  boardUsePicture.value = true;
  return true;
}

/** Forgets the board picture, leaving the colour and texture on the board. */
export async function removeBoardImage(): Promise<boolean> {
  try {
    await deleteBoardImage();
  } catch {
    showError(t("settings.boardBackground.saveFailed"));
    return false;
  }
  boardUsePicture.value = false;
  boardImageStamp.value = 0;
  return true;
}
