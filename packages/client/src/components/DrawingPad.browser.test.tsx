import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cdp } from "vitest/browser";
import { t } from "../i18n/index.js";
import { answerConfirmation, confirmRequest } from "../state/confirm.js";
import { drawingRequest, requestDrawing } from "../state/drawing.js";
import { DRAWING_HEIGHT, DRAWING_WIDTH } from "../utils/drawing.js";
import { DrawingPad } from "./DrawingPad.js";
import "../styles.css";

type Cdp = { send: (method: string, params?: object) => Promise<unknown> };
const session = () => cdp() as unknown as Cdp;

let host: HTMLDivElement;
let saved: File[];

const canvas = () => host.querySelector("canvas") as HTMLCanvasElement;
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

/** The colour of the drawing at a point given as fractions of the paper. */
function inkAt(fx: number, fy: number, from = canvas()): string {
  const ctx = from.getContext("2d") as CanvasRenderingContext2D;
  const [r, g, b] = ctx.getImageData(
    Math.round(fx * DRAWING_WIDTH),
    Math.round(fy * DRAWING_HEIGHT),
    1,
    1,
  ).data;
  return `${r},${g},${b}`;
}
const PAPER = "255,255,255";

/** Where a fraction of the paper is on the screen. */
function screenPoint(fx: number, fy: number) {
  const rect = canvas().getBoundingClientRect();
  return {
    clientX: rect.left + fx * rect.width,
    clientY: rect.top + fy * rect.height,
  };
}

/** A line drawn with synthetic pointer events, as a pen would send them. */
function drawLine(
  from: [number, number],
  to: [number, number],
  init: PointerEventInit = {},
) {
  const base = {
    pointerId: 1,
    isPrimary: true,
    bubbles: true,
    button: 0,
    pointerType: "pen",
    ...init,
  };
  const at = (p: [number, number]) => ({ ...base, ...screenPoint(...p) });
  canvas().dispatchEvent(new PointerEvent("pointerdown", at(from)));
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    canvas().dispatchEvent(
      new PointerEvent(
        "pointermove",
        at([
          from[0] + ((to[0] - from[0]) * i) / steps,
          from[1] + ((to[1] - from[1]) * i) / steps,
        ]),
      ),
    );
  }
  canvas().dispatchEvent(new PointerEvent("pointerup", at(to)));
}

const settled = () => new Promise((r) => requestAnimationFrame(r));

beforeEach(async () => {
  saved = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  requestDrawing((file) => saved.push(file));
  render(<DrawingPad />, host);
  await settled();
});

afterEach(() => {
  render(null, host);
  host.remove();
  drawingRequest.value = null;
  if (confirmRequest.value) answerConfirmation(false);
});

describe("DrawingPad", () => {
  it("starts as blank paper that no page gesture can take a stroke from", () => {
    expect(inkAt(0.5, 0.5)).toBe(PAPER);
    expect(getComputedStyle(canvas()).touchAction).toBe("none");
    // Shown at the drawing's own shape, whatever room there is.
    const rect = canvas().getBoundingClientRect();
    expect(rect.width / rect.height).toBeCloseTo(
      DRAWING_WIDTH / DRAWING_HEIGHT,
      1,
    );
  });

  it("draws where the pointer goes, in the ink chosen", async () => {
    drawLine([0.2, 0.5], [0.8, 0.5]);
    await settled();
    expect(inkAt(0.5, 0.5)).toBe("23,23,23");
    expect(inkAt(0.5, 0.2)).toBe(PAPER);

    button("Red")?.click();
    await settled();
    drawLine([0.5, 0.1], [0.5, 0.3]);
    await settled();
    expect(inkAt(0.5, 0.2)).toBe("220,38,38");
  });

  it("leaves a dot for a tap", async () => {
    drawLine([0.3, 0.3], [0.3, 0.3]);
    await settled();
    expect(inkAt(0.3, 0.3)).not.toBe(PAPER);
  });

  it("draws one line at a time: a second finger is not a second pen", async () => {
    const first = { pointerId: 1, pointerType: "touch", bubbles: true };
    canvas().dispatchEvent(
      new PointerEvent("pointerdown", {
        ...first,
        isPrimary: true,
        ...screenPoint(0.2, 0.2),
      }),
    );
    // A palm lands while the first finger is down.
    canvas().dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 2,
        pointerType: "touch",
        isPrimary: false,
        bubbles: true,
        ...screenPoint(0.8, 0.8),
      }),
    );
    canvas().dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: 2,
        pointerType: "touch",
        bubbles: true,
        ...screenPoint(0.9, 0.9),
      }),
    );
    canvas().dispatchEvent(
      new PointerEvent("pointerup", {
        ...first,
        isPrimary: true,
        ...screenPoint(0.2, 0.2),
      }),
    );
    await settled();
    expect(inkAt(0.2, 0.2)).not.toBe(PAPER);
    expect(inkAt(0.8, 0.8)).toBe(PAPER);
    expect(inkAt(0.85, 0.85)).toBe(PAPER);
  });

  it("keeps what was drawn when the system takes the touch away", async () => {
    const touch = {
      pointerId: 5,
      pointerType: "touch",
      isPrimary: true,
      bubbles: true,
    };
    const at = (p: [number, number]) => ({ ...touch, ...screenPoint(...p) });
    canvas().dispatchEvent(new PointerEvent("pointerdown", at([0.2, 0.7])));
    canvas().dispatchEvent(new PointerEvent("pointermove", at([0.6, 0.7])));
    canvas().dispatchEvent(new PointerEvent("pointercancel", at([0.6, 0.7])));
    await settled();
    expect(inkAt(0.4, 0.7)).not.toBe(PAPER);
    // And the pad takes the next stroke: nothing is left half-drawn.
    drawLine([0.2, 0.9], [0.6, 0.9]);
    await settled();
    expect(inkAt(0.4, 0.9)).not.toBe(PAPER);
  });

  it("undoes a stroke, rubs one out, and clears the paper", async () => {
    drawLine([0.2, 0.5], [0.8, 0.5]);
    drawLine([0.2, 0.8], [0.8, 0.8]);
    await settled();
    button(t("editor.undo"))?.click();
    await settled();
    expect(inkAt(0.5, 0.8)).toBe(PAPER);
    expect(inkAt(0.5, 0.5)).not.toBe(PAPER);

    button(t("drawing.eraser"))?.click();
    await settled();
    drawLine([0.4, 0.5], [0.6, 0.5]);
    await settled();
    expect(inkAt(0.5, 0.5)).toBe(PAPER);
    expect(inkAt(0.25, 0.5)).not.toBe(PAPER);

    button(t("drawing.clear"))?.click();
    await settled();
    expect(inkAt(0.25, 0.5)).toBe(PAPER);
  });

  it("hands the drawing over as a PNG with the ink in it", async () => {
    drawLine([0.2, 0.5], [0.8, 0.5]);
    await settled();
    button(t("editor.done"))?.click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const file = saved[0] as File;
    expect(file.type).toBe("image/png");
    expect(file.name).toBe(t("drawing.fileName"));
    expect(drawingRequest.value).toBeNull();

    // Decoded again: the picture is the drawing, at its own size.
    const bitmap = await createImageBitmap(file);
    expect([bitmap.width, bitmap.height]).toEqual([
      DRAWING_WIDTH,
      DRAWING_HEIGHT,
    ]);
    const copy = document.createElement("canvas");
    copy.width = bitmap.width;
    copy.height = bitmap.height;
    copy.getContext("2d")?.drawImage(bitmap, 0, 0);
    expect(inkAt(0.5, 0.5, copy)).toBe("23,23,23");
    expect(inkAt(0.5, 0.2, copy)).toBe(PAPER);
  });

  it("saves nothing for paper nobody drew on", async () => {
    button(t("editor.done"))?.click();
    await settled();
    expect(saved).toEqual([]);
    expect(drawingRequest.value).toBeNull();
  });

  it("asks before a drawing is thrown away, and not when there is none", async () => {
    drawLine([0.2, 0.5], [0.8, 0.5]);
    await settled();
    button(t("drawing.cancel"))?.click();
    await vi.waitFor(() => expect(confirmRequest.value).not.toBeNull());
    answerConfirmation(false);
    await settled();
    expect(drawingRequest.value).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.waitFor(() => expect(confirmRequest.value).not.toBeNull());
    answerConfirmation(true);
    await vi.waitFor(() => expect(drawingRequest.value).toBeNull());
    expect(saved).toEqual([]);
  });

  it("keeps Back its own after the reader chooses not to discard", async () => {
    const popped = () =>
      new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
    const padEntry = history.state;
    drawLine([0.2, 0.5], [0.8, 0.5]);
    await settled();

    let pop = popped();
    history.back();
    await pop;
    await vi.waitFor(() => expect(confirmRequest.value).not.toBeNull());
    // The pad is still up, so its entry is back for the next press to pop.
    expect(history.state).toEqual(padEntry);
    answerConfirmation(false);
    await settled();
    expect(drawingRequest.value).not.toBeNull();

    pop = popped();
    history.back();
    await pop;
    await vi.waitFor(() => expect(confirmRequest.value).not.toBeNull());
    answerConfirmation(true);
    await vi.waitFor(() => expect(drawingRequest.value).toBeNull());
  });

  it("shows the line being drawn as it will be once let go", async () => {
    const pen = { pointerId: 1, isPrimary: true, bubbles: true, button: 0 };
    const at = (p: [number, number]) => ({ ...pen, ...screenPoint(...p) });
    const strip = () =>
      [
        ...(canvas().getContext("2d") as CanvasRenderingContext2D).getImageData(
          0,
          DRAWING_HEIGHT / 2 - 40,
          DRAWING_WIDTH,
          80,
        ).data,
      ].join();
    canvas().dispatchEvent(new PointerEvent("pointerdown", at([0.2, 0.5])));
    for (let i = 1; i <= 12; i++) {
      canvas().dispatchEvent(
        new PointerEvent("pointermove", at([0.2 + i * 0.05, 0.5])),
      );
      await settled();
    }
    const drawn = strip();
    canvas().dispatchEvent(new PointerEvent("pointerup", at([0.8, 0.5])));
    await settled();
    expect(inkAt(0.5, 0.5)).toBe("23,23,23");
    expect(strip()).toBe(drawn);
  });

  it("saves a line the pen has not yet left", async () => {
    const pen = { pointerId: 1, isPrimary: true, bubbles: true, button: 0 };
    const at = (p: [number, number]) => ({ ...pen, ...screenPoint(...p) });
    canvas().dispatchEvent(new PointerEvent("pointerdown", at([0.2, 0.5])));
    canvas().dispatchEvent(new PointerEvent("pointermove", at([0.8, 0.5])));
    button(t("editor.done"))?.click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const bitmap = await createImageBitmap(saved[0] as File);
    const copy = document.createElement("canvas");
    copy.width = bitmap.width;
    copy.height = bitmap.height;
    copy.getContext("2d")?.drawImage(bitmap, 0, 0);
    expect(inkAt(0.5, 0.5, copy)).toBe("23,23,23");
  });

  it("stays open, drawing and all, when the picture cannot be made", async () => {
    drawLine([0.2, 0.5], [0.8, 0.5]);
    await settled();
    const toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => callback(null));
    try {
      button(t("editor.done"))?.click();
      await vi.waitFor(() =>
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(
          t("drawing.saveFailed"),
        ),
      );
    } finally {
      toBlob.mockRestore();
    }
    expect(saved).toEqual([]);
    expect(drawingRequest.value).not.toBeNull();
    expect(inkAt(0.5, 0.5)).toBe("23,23,23");

    // And the second try goes through.
    button(t("editor.done"))?.click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
  });

  it("opens an image as the paper, at its own shape, and saves the lines over it", async () => {
    // A tall, plain blue picture, as the note would hold it.
    const picture = document.createElement("canvas");
    picture.width = 300;
    picture.height = 600;
    const pictureCtx = picture.getContext("2d") as CanvasRenderingContext2D;
    pictureCtx.fillStyle = "#0000ff";
    pictureCtx.fillRect(0, 0, 300, 600);
    const BLUE = "0,0,255";
    const pixel = (from: HTMLCanvasElement, fx: number, fy: number) => {
      const ctx = from.getContext("2d") as CanvasRenderingContext2D;
      const [r, g, b] = ctx.getImageData(
        Math.round(fx * from.width),
        Math.round(fy * from.height),
        1,
        1,
      ).data;
      return `${r},${g},${b}`;
    };

    render(null, host);
    requestDrawing((file) => saved.push(file), picture.toDataURL("image/png"));
    render(<DrawingPad />, host);
    await vi.waitFor(() =>
      expect([canvas().width, canvas().height]).toEqual([800, 1600]),
    );
    await vi.waitFor(() => expect(pixel(canvas(), 0.5, 0.5)).toBe(BLUE));
    const rect = canvas().getBoundingClientRect();
    expect(rect.width / rect.height).toBeCloseTo(0.5, 1);

    // Nothing drawn: the note's image is left as it is.
    button(t("editor.done"))?.click();
    await settled();
    expect(saved).toEqual([]);

    requestDrawing((file) => saved.push(file), picture.toDataURL("image/png"));
    render(<DrawingPad />, host);
    await vi.waitFor(() => expect(pixel(canvas(), 0.5, 0.5)).toBe(BLUE));
    drawLine([0.2, 0.5], [0.8, 0.5]);
    await settled();
    expect(pixel(canvas(), 0.5, 0.5)).toBe("23,23,23");
    // Undo takes the line and leaves the picture.
    button(t("editor.undo"))?.click();
    await settled();
    expect(pixel(canvas(), 0.5, 0.5)).toBe(BLUE);
    drawLine([0.2, 0.5], [0.8, 0.5]);
    await settled();

    button(t("editor.done"))?.click();
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    const bitmap = await createImageBitmap(saved[0] as File);
    const copy = document.createElement("canvas");
    copy.width = bitmap.width;
    copy.height = bitmap.height;
    copy.getContext("2d")?.drawImage(bitmap, 0, 0);
    expect([copy.width, copy.height]).toEqual([800, 1600]);
    expect(pixel(copy, 0.5, 0.5)).toBe("23,23,23");
    expect(pixel(copy, 0.5, 0.2)).toBe(BLUE);
  });

  it("draws with a real finger, and the page under it stays put", async () => {
    await session().send("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
    });
    try {
      // A page tall enough to scroll, as the board behind a note is.
      const filler = document.createElement("div");
      filler.style.height = "3000px";
      document.body.appendChild(filler);
      const from = screenPoint(0.5, 0.3);
      const to = screenPoint(0.5, 0.7);
      const touch = (
        type: string,
        point?: { clientX: number; clientY: number },
      ) =>
        session().send("Input.dispatchTouchEvent", {
          type,
          touchPoints: point
            ? [{ x: Math.round(point.clientX), y: Math.round(point.clientY) }]
            : [],
        });
      await touch("touchStart", from);
      for (let i = 1; i <= 6; i++) {
        await touch("touchMove", {
          clientX: from.clientX,
          clientY: from.clientY + ((to.clientY - from.clientY) * i) / 6,
        });
      }
      await touch("touchEnd");
      await settled();
      filler.remove();

      expect(inkAt(0.5, 0.5)).not.toBe(PAPER);
      // A vertical drag on anything else would have scrolled the page.
      expect(window.scrollY).toBe(0);
    } finally {
      await session().send("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
    }
  });
});
