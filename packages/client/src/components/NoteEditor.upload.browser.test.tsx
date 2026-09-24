import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { forgetAttachmentUrls } from "../state/attachments.js";
import { activeView, notes } from "../state/index.js";
import { currentStorage } from "../storage/index.js";
import { NoteInput } from "./NoteInput.js";

const REF = "attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV";
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

let host: HTMLDivElement;
let putImage: ReturnType<typeof vi.fn>;

async function openDraft(): Promise<HTMLElement> {
  (host.querySelector(".note-stack") as HTMLElement).click();
  return await vi.waitFor(() => {
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.querySelector(".ProseMirror")).toBeTruthy();
    return dialog as HTMLElement;
  });
}

function attach(dialog: HTMLElement) {
  const input = dialog.querySelector<HTMLInputElement>(
    'input[type="file"]',
  ) as HTMLInputElement;
  const files = new DataTransfer();
  files.items.add(new File([PNG], "dot.png", { type: "image/png" }));
  input.files = files.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("attaching an image", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    forgetAttachmentUrls();
    activeView.value = "active";
    host = document.createElement("div");
    document.body.appendChild(host);
    render(<NoteInput />, host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    render(null, host);
    host.remove();
    localStorage.clear();
  });

  function storeWith(impl: typeof putImage) {
    putImage = impl;
    const real = currentStorage.value;
    vi.spyOn(currentStorage, "value", "get").mockReturnValue(
      Object.assign(Object.create(Object.getPrototypeOf(real)), real, {
        putImage,
      }) as never,
    );
  }

  it("shows progress while it uploads and keeps the reference", async () => {
    let finish: (ref: string) => void = () => {};
    storeWith(
      vi.fn(
        (_blob: Blob, options?: { onProgress?: (p: number) => void }) =>
          new Promise<string>((resolve) => {
            options?.onProgress?.(0.4);
            finish = resolve;
          }),
      ),
    );
    const dialog = await openDraft();
    attach(dialog);
    const bar = await vi.waitFor(() => {
      const found = dialog.querySelector('[role="progressbar"]');
      expect(found?.getAttribute("aria-valuenow")).toBe("40");
      return found;
    });
    expect(bar).toBeTruthy();
    finish(REF);
    await vi.waitFor(() =>
      expect(dialog.querySelector('[role="progressbar"]')).toBeNull(),
    );
    await vi.waitFor(() =>
      expect(dialog.querySelector("img")?.src).toMatch(/^blob:/),
    );
    (
      dialog.querySelector(
        `button[aria-label="${t("editor.done")}"]`,
      ) as HTMLElement
    ).click();
    await vi.waitFor(() => expect(notes.value).toHaveLength(1));
    expect(notes.value[0].images).toEqual([REF]);
  });

  it("keeps a failed upload marked, and tries again on request", async () => {
    let attempt = 0;
    storeWith(
      vi.fn(async () => {
        attempt++;
        if (attempt === 1) throw new Error("offline");
        return REF;
      }),
    );
    const dialog = await openDraft();
    attach(dialog);
    const retry = await vi.waitFor(() => {
      const button = [...dialog.querySelectorAll("button")].find(
        (b) => b.textContent === t("editor.retryUpload"),
      );
      expect(button).toBeTruthy();
      return button as HTMLButtonElement;
    });
    retry.click();
    await vi.waitFor(() => expect(attempt).toBe(2));
    await vi.waitFor(() =>
      expect(
        [...dialog.querySelectorAll("button")].some(
          (b) => b.textContent === t("editor.retryUpload"),
        ),
      ).toBe(false),
    );
  });

  it("drops an upload that finishes after the composer closed", async () => {
    let finish: (ref: string) => void = () => {};
    storeWith(
      vi.fn(
        () =>
          new Promise<string>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const first = await openDraft();
    attach(first);
    await vi.waitFor(() => expect(putImage).toHaveBeenCalled());
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    finish(REF);
    await new Promise((r) => setTimeout(r, 50));
    const second = await openDraft();
    expect(second.querySelector("img")).toBeNull();
    expect(notes.value).toHaveLength(0);
  });
});
