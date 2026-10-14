import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defined } from "../test/defined.js";
import {
  activeView,
  dismissToast,
  exitSearch,
  holdToasts,
  MAX_TOASTS,
  previousView,
  SEARCH_DEBOUNCE_MS,
  SUCCESS_TOAST_MS,
  searchColors,
  searchInput,
  searchQuery,
  searchTypes,
  showError,
  showSuccess,
  toasts,
  typeSearch,
} from "./ui.js";

describe("error notifications", () => {
  beforeEach(() => {
    toasts.value = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    holdToasts(false);
    vi.useRealTimers();
  });

  it("showError adds an error to the list", () => {
    showError("Something went wrong");
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]?.message).toBe("Something went wrong");
  });

  it("showError assigns unique ids", () => {
    showError("Error 1");
    showError("Error 2");
    expect(defined(toasts.value[0]).id).not.toBe(toasts.value[1]?.id);
  });

  it("dismissToast removes a specific error", () => {
    showError("Error 1");
    showError("Error 2");
    const id = defined(toasts.value[0]).id;
    dismissToast(id);
    expect(toasts.value).toHaveLength(1);
    expect(toasts.value[0]?.message).toBe("Error 2");
  });

  it("keeps an error until it is dismissed", () => {
    showError("Still here");
    vi.advanceTimersByTime(60_000);
    expect(toasts.value).toHaveLength(1);
  });

  it("lets a success go after 5 seconds", () => {
    showSuccess("Saved");
    vi.advanceTimersByTime(SUCCESS_TOAST_MS - 1);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.value).toHaveLength(0);
  });

  it("keeps a success while the stack is held, and for its time after", () => {
    showSuccess("Saved");
    holdToasts(true);
    vi.advanceTimersByTime(SUCCESS_TOAST_MS * 3);
    expect(toasts.value).toHaveLength(1);
    holdToasts(false);
    vi.advanceTimersByTime(SUCCESS_TOAST_MS - 1);
    expect(toasts.value).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toasts.value).toHaveLength(0);
  });

  it("shows at most a few, dropping the oldest", () => {
    for (let i = 0; i < MAX_TOASTS + 2; i++) showError(`Error ${i}`);
    expect(toasts.value).toHaveLength(MAX_TOASTS);
    expect(toasts.value[0]?.message).toBe("Error 2");
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

describe("typeSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    typeSearch("");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows each keystroke at once and filters once typing pauses", () => {
    typeSearch("m");
    typeSearch("mi");
    typeSearch("mil");
    expect(searchInput.value).toBe("mil");
    expect(searchQuery.value).toBe("");

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    typeSearch("milk");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(searchQuery.value).toBe("");

    vi.advanceTimersByTime(1);
    expect(searchQuery.value).toBe("milk");
  });

  it("clears the results at once when the field is emptied", () => {
    typeSearch("milk");
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    typeSearch("mil");
    typeSearch("");
    expect(searchQuery.value).toBe("");

    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(searchQuery.value).toBe("");
  });

  it("drops a pending query when the search is left", () => {
    typeSearch("milk");
    exitSearch();
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(searchInput.value).toBe("");
    expect(searchQuery.value).toBe("");
  });
});
