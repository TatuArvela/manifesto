import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeView,
  dismissError,
  errors,
  exitSearch,
  previousView,
  searchColors,
  searchQuery,
  searchTypes,
  showError,
} from "./ui.js";

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

describe("exitSearch", () => {
  beforeEach(() => {
    activeView.value = "active";
    searchQuery.value = "";
    searchTypes.value = new Set();
    searchColors.value = new Set();
  });

  it("returns to the view the user came from and clears the filters", () => {
    activeView.value = "archived";
    activeView.value = "search";
    searchQuery.value = "milk";
    searchTypes.value = new Set(["images"]);

    exitSearch();

    expect(activeView.value).toBe("archived");
    expect(searchQuery.value).toBe("");
    expect(searchTypes.value.size).toBe(0);
  });

  it("falls back to the active view when search was the entry point", () => {
    previousView.value = "search";
    activeView.value = "search";

    exitSearch();

    expect(activeView.value).toBe("active");
  });
});
