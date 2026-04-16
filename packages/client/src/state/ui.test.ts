import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissError, errors, showError } from "./ui.js";

describe("error notifications", () => {
  beforeEach(() => {
    errors.value = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("showError adds an error to the list", () => {
    showError("Something went wrong");
    expect(errors.value).toHaveLength(1);
    expect(errors.value[0].message).toBe("Something went wrong");
  });

  it("showError assigns unique ids", () => {
    showError("Error 1");
    showError("Error 2");
    expect(errors.value[0].id).not.toBe(errors.value[1].id);
  });

  it("dismissError removes a specific error", () => {
    showError("Error 1");
    showError("Error 2");
    const id = errors.value[0].id;
    dismissError(id);
    expect(errors.value).toHaveLength(1);
    expect(errors.value[0].message).toBe("Error 2");
  });

  it("errors auto-dismiss after 5 seconds", () => {
    showError("Temporary error");
    expect(errors.value).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(errors.value).toHaveLength(0);
  });

  it("multiple errors stack and auto-dismiss independently", () => {
    showError("Error 1");
    vi.advanceTimersByTime(2000);
    showError("Error 2");
    expect(errors.value).toHaveLength(2);
    vi.advanceTimersByTime(3000); // 5s after Error 1
    expect(errors.value).toHaveLength(1);
    expect(errors.value[0].message).toBe("Error 2");
    vi.advanceTimersByTime(2000); // 5s after Error 2
    expect(errors.value).toHaveLength(0);
  });
});
