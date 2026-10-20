import { effect, signal } from "@preact/signals";
import { t } from "#/i18n/index.ts";
import {
  deleteBoardImage,
  loadBoardImage,
  saveBoardImage,
  shrinkBoardImage,
} from "#/storage/boardImage.ts";
import { boardImageStamp, boardUsePicture } from "./prefs.ts";
import { showError } from "./ui.ts";

/**
 * An object URL for the stored board picture, or null when there is none. Kept
 * also while the color and texture show. Thus, Settings can offer the picture.
 */
export const boardImageUrl = signal<string | null>(null);

let started = false;

/**
 * Loads the board picture each time one is stored, here or in a different tab
 * (its stamp changes in the shared preferences), and paints it over the full
 * board while it is in use. `App` calls it one time.
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
        // Replaced again while this one loaded.
        if (mine !== generation) return;
        setUrl(blob ? URL.createObjectURL(blob) : null);
      });
  });

  // The key is that the picture loaded, not only that it is wanted. Until then,
  // and if it never loads, the color and texture stay on the board, not a
  // blank.
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
 * resolves false, as the actions in actions.ts do.
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

/** Forgets the board picture, and leaves the color and texture on the board. */
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
