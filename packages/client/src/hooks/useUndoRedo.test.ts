import { act, renderHook } from "@testing-library/preact";
import { describe, expect, it } from "vitest";
import { useUndoRedo } from "./useUndoRedo.js";

describe("useUndoRedo", () => {
  it("initializes with given title and content", () => {
    const { result } = renderHook(() => useUndoRedo("Title", "Content"));
    expect(result.current.title).toBe("Title");
    expect(result.current.content).toBe("Content");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("updates title and content", () => {
    const { result } = renderHook(() => useUndoRedo("", ""));
    act(() => result.current.setTitle("New Title"));
    expect(result.current.title).toBe("New Title");
    act(() => result.current.setContent("New Content"));
    expect(result.current.content).toBe("New Content");
  });

  it("marks canUndo as true after a change", () => {
    const { result } = renderHook(() => useUndoRedo("", ""));
    act(() => result.current.setTitle("Changed"));
    expect(result.current.canUndo).toBe(true);
  });

  it("undoes a change after snapshot is flushed", async () => {
    const { result } = renderHook(() => useUndoRedo("Original", ""));
    act(() => result.current.setTitle("Changed"));

    // Wait for debounce to flush
    await new Promise((r) => setTimeout(r, 600));

    act(() => result.current.undo());
    expect(result.current.title).toBe("Original");
    expect(result.current.canRedo).toBe(true);
  });

  it("redoes after undo", async () => {
    const { result } = renderHook(() => useUndoRedo("Original", ""));
    act(() => result.current.setTitle("Changed"));
    await new Promise((r) => setTimeout(r, 600));

    act(() => result.current.undo());
    expect(result.current.title).toBe("Original");

    act(() => result.current.redo());
    expect(result.current.title).toBe("Changed");
    expect(result.current.canRedo).toBe(false);
  });

  it("resets clears history", () => {
    const { result } = renderHook(() => useUndoRedo("A", "B"));
    act(() => result.current.setTitle("Changed"));
    act(() => result.current.reset("Reset", "Reset Content"));

    expect(result.current.title).toBe("Reset");
    expect(result.current.content).toBe("Reset Content");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("undo flushes pending snapshot first", () => {
    const { result } = renderHook(() => useUndoRedo("", ""));
    act(() => result.current.setTitle("A"));
    // Undo before debounce fires — should still flush and undo
    act(() => result.current.undo());
    expect(result.current.title).toBe("");
  });

  it("handles multiple sequential changes as single undo step when within debounce window", async () => {
    const { result } = renderHook(() => useUndoRedo("", ""));
    act(() => {
      result.current.setTitle("A");
      result.current.setTitle("AB");
      result.current.setTitle("ABC");
    });
    await new Promise((r) => setTimeout(r, 600));

    act(() => result.current.undo());
    // All three changes were within one debounce window -> one snapshot
    expect(result.current.title).toBe("");
  });
});
