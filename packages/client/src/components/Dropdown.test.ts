import { describe, expect, it } from "vitest";
import { computePanelPosition } from "./Dropdown.tsx";

const VIEWPORT = { width: 1000, height: 600 };
const PANEL = { width: 160, height: 200 };

/** A 100x30 trigger with its top-left corner at (x, y). */
const triggerAt = (x: number, y: number) => ({
  left: x,
  right: x + 100,
  top: y,
  bottom: y + 30,
});

describe("computePanelPosition", () => {
  it("opens below the trigger when there is room", () => {
    const { top } = computePanelPosition(
      triggerAt(200, 100),
      PANEL,
      VIEWPORT,
      "bottom-start",
    );
    // A gap of 4px under the bottom edge of the trigger.
    expect(top).toBe(134);
  });

  it("flips above the trigger when the panel would overflow the bottom", () => {
    const trigger = triggerAt(200, 500);
    const { top } = computePanelPosition(
      trigger,
      PANEL,
      VIEWPORT,
      "bottom-start",
    );
    // Below, it would end at 534 + 200 = 734, past the 600px viewport, and
    // there is space above. Thus, it is 4px above the top edge of the trigger.
    expect(top).toBe(500 - 200 - 4);
    expect(top + PANEL.height).toBeLessThanOrEqual(trigger.top);
  });

  it("flips below when a top-placed panel would overflow the top", () => {
    const { top } = computePanelPosition(
      triggerAt(200, 40),
      PANEL,
      VIEWPORT,
      "top-start",
    );
    expect(top).toBe(74);
  });

  it("does not flip when the opposite side has no room either", () => {
    // The trigger is low, but the panel is too tall to fit above it.
    const tall = { width: 160, height: 480 };
    const { top } = computePanelPosition(
      triggerAt(200, 400),
      tall,
      VIEWPORT,
      "bottom-start",
    );
    // Clamped into view, not flipped to a position that is equally bad.
    expect(top).toBe(VIEWPORT.height - tall.height - 4);
    expect(top).toBeGreaterThanOrEqual(4);
  });

  it("aligns the leading edge for -start and the trailing edge for -end", () => {
    const trigger = triggerAt(400, 100);
    expect(
      computePanelPosition(trigger, PANEL, VIEWPORT, "bottom-start").left,
    ).toBe(400);
    expect(
      computePanelPosition(trigger, PANEL, VIEWPORT, "bottom-end").left,
    ).toBe(trigger.right - PANEL.width);
  });

  it("keeps the panel inside the left and right edges", () => {
    expect(
      computePanelPosition(triggerAt(0, 100), PANEL, VIEWPORT, "bottom-end")
        .left,
    ).toBe(4);
    expect(
      computePanelPosition(triggerAt(960, 100), PANEL, VIEWPORT, "bottom-start")
        .left,
    ).toBe(VIEWPORT.width - PANEL.width - 4);
  });

  it("never returns a negative offset for a panel larger than the viewport", () => {
    const huge = { width: 1200, height: 900 };
    const { left, top } = computePanelPosition(
      triggerAt(100, 100),
      huge,
      VIEWPORT,
      "bottom-start",
    );
    expect(left).toBe(4);
    expect(top).toBe(4);
  });

  it("sits beside the trigger for inline-end, centred on it", () => {
    const position = computePanelPosition(
      triggerAt(200, 100),
      { width: 160, height: 40 },
      VIEWPORT,
      "inline-end",
    );
    // 4px after the right edge of the trigger, centered on its 30px height.
    expect(position).toEqual({ left: 304, top: 95 });
  });

  it("goes above and back to the left for inline-end without room after", () => {
    const position = computePanelPosition(
      triggerAt(800, 100),
      { width: 160, height: 40 },
      VIEWPORT,
      "inline-end",
    );
    // The trailing edge on the right edge of the trigger, 4px above its top.
    expect(position).toEqual({ left: 740, top: 56 });
  });
});
