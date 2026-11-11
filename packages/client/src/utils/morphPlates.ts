/**
 * The shadow of a panel while it morphs (`utils/morph.ts`), drawn by "plates":
 * empty boxes under the panel that carry a shadow and only move, scale and
 * fade. Those run on the compositor in all browsers.
 *
 * Before, the panel animated its own `box-shadow`, divided by the scale in each
 * keyframe. A `box-shadow` animation runs on the main thread. Thus, each frame
 * of each open and close asked the main thread for 6 to 8 ms on a board of 86
 * cards, and the shadow stopped while the main thread was busy, and lost its
 * place under the moving panel.
 *
 * A plate is laid out at one end of the path with the computed shadow of that
 * end, and is drawn over each rectangle of the path. Thus, it is exact at its
 * own end and scaled between. The shadow of the card fades out as the shadow
 * of the panel fades in, by the progress of the run. While a plate draws the
 * shadow, the own shadow of the panel is off.
 *
 * A plate is `position: fixed` before the panel. Thus, it is in the stacking
 * context of the sheet, under the panel, and outside the clip of the panel. No
 * ancestor of a sheet makes a containing block for a fixed element. Thus, its
 * place is in the coordinates of the viewport.
 */

import {
  type CornerPath,
  type PathStop,
  plateFrame,
  type RectLike,
} from "./morphPath.ts";
import { drawsShadow } from "./morphShadow.ts";

/**
 * The computed `box-shadow` at each end of a morph: the card and the panel. The
 * same value at both ends for a panel that keeps its own shadow.
 */
export interface ShadowPath {
  from: string;
  to: string;
  /**
   * The part of `to` that is drawn at the start, from 0 (the default) to 1. A
   * close during a grow starts with the blend that the grow drew there. From
   * the full shadow of the panel, the shadow jumped at the press.
   */
  startMix?: number | undefined;
}

/** A plate of a run, and its strength at each offset of the run. */
export interface Plate {
  element: HTMLElement;
  /** Where it is laid out. */
  box: RectLike;
  /** Laid out at the layout of the panel, which it follows when that moves. */
  followsLayout: boolean;
  strength: (offset: number) => number;
}

/** Lays `element` out at `box`, in the coordinates of the viewport. */
function place(element: HTMLElement, box: RectLike) {
  Object.assign(element.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

/**
 * Lays the plate of the panel out at the new layout of the panel, when a grow
 * is aimed again (`keepAimed` in `utils/morph.ts`). Thus, it lands at the size
 * of the own shadow of the panel. A plate at the card stays there.
 */
export function movePlate(plate: Plate, layout: RectLike) {
  if (!plate.followsLayout) return;
  plate.box = layout;
  place(plate.element, layout);
}

/**
 * Makes the plates of a run from `start` to `end` and puts them before
 * `panel`. Each has its look at its own end: it is laid out there with the
 * shadow and the radius of that end. The opacity that it has when no keyframe
 * applies is the one that it has at the end of the run. Thus, a plate never
 * shows in its own box when its animation is gone before the plate is.
 *
 * `fade` is the opacity of the panel at each offset, for a panel that fades.
 */
export function platesFor(
  panel: HTMLElement,
  ends: { start: RectLike; end: RectLike; layout: RectLike },
  shadows: ShadowPath,
  corners: CornerPath,
  fade?: ((offset: number) => number) | undefined,
): Plate[] {
  const plates: Plate[] = [];
  const faded = (offset: number) => fade?.(offset) ?? 1;
  const add = (
    shadow: string,
    box: RectLike,
    radius: number,
    strength: (offset: number) => number,
  ) => {
    if (!drawsShadow(shadow)) return;
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    element.dataset.morphPlate = "";
    Object.assign(element.style, {
      position: "fixed",
      margin: "0",
      boxShadow: shadow,
      borderRadius: `${radius}px`,
      opacity: String(strength(1)),
      transformOrigin: "0 0",
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    place(element, box);
    plates.push({
      element,
      box,
      followsLayout: box === ends.layout,
      strength,
    });
  };
  if (shadows.from === shadows.to) {
    add(shadows.to, ends.layout, corners.to, faded);
  } else {
    const mix = shadows.startMix ?? 0;
    const toward = (o: number) => mix + (1 - mix) * o;
    add(
      shadows.from,
      ends.start,
      corners.from,
      (o) => (1 - toward(o)) * faded(o),
    );
    add(shadows.to, ends.end, corners.to, (o) => toward(o) * faded(o));
  }
  if (plates.length > 0) panel.before(...plates.map((plate) => plate.element));
  return plates;
}

/** The keyframes that draw `plate` over each stop of a run. */
export function plateFrames(plate: Plate, stops: PathStop[]): Keyframe[] {
  return stops.map(({ offset, rect }) => ({
    ...plateFrame(plate.box, rect),
    opacity: plate.strength(offset),
    offset,
  }));
}
