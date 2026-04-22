import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPath, initRouter, parsePath, stopRouter } from "./router.js";
import { activeTag, activeView } from "./ui.js";

function resetUrl() {
  history.replaceState(null, "", "/");
}

describe("parsePath", () => {
  it("parses the root", () => {
    expect(parsePath("/")).toEqual({ view: "active", tag: null });
  });

  it("parses each top-level view", () => {
    expect(parsePath("/tags")).toEqual({ view: "tags", tag: null });
    expect(parsePath("/reminders")).toEqual({ view: "reminders", tag: null });
    expect(parsePath("/archived")).toEqual({ view: "archived", tag: null });
    expect(parsePath("/trash")).toEqual({ view: "trash", tag: null });
  });

  it("parses a tag sub-route", () => {
    expect(parsePath("/tags/work")).toEqual({ view: "tags", tag: "work" });
  });

  it("decodes URL-encoded tag names", () => {
    expect(parsePath("/tags/hello%20world")).toEqual({
      view: "tags",
      tag: "hello world",
    });
  });

  it("returns null for unrecognized paths", () => {
    expect(parsePath("/bogus")).toBeNull();
  });
});

describe("buildPath", () => {
  it("serializes the active view to the root", () => {
    expect(buildPath({ view: "active", tag: null })).toBe("/");
  });

  it("serializes each top-level view", () => {
    expect(buildPath({ view: "tags", tag: null })).toBe("/tags");
    expect(buildPath({ view: "reminders", tag: null })).toBe("/reminders");
    expect(buildPath({ view: "archived", tag: null })).toBe("/archived");
    expect(buildPath({ view: "trash", tag: null })).toBe("/trash");
  });

  it("serializes a selected tag", () => {
    expect(buildPath({ view: "tags", tag: "work" })).toBe("/tags/work");
  });

  it("URL-encodes the tag name", () => {
    expect(buildPath({ view: "tags", tag: "hello world" })).toBe(
      "/tags/hello%20world",
    );
  });

  it("ignores the tag when not on the tags view", () => {
    expect(buildPath({ view: "archived", tag: "work" })).toBe("/archived");
  });
});

describe("parse/build round-trip", () => {
  const cases = [
    "/",
    "/tags",
    "/tags/work",
    "/tags/hello%20world",
    "/reminders",
    "/archived",
    "/trash",
  ];
  for (const path of cases) {
    it(`preserves ${path}`, () => {
      const parsed = parsePath(path);
      expect(parsed).not.toBeNull();
      if (parsed) expect(buildPath(parsed)).toBe(path);
    });
  }
});

describe("initRouter", () => {
  beforeEach(() => {
    resetUrl();
    activeView.value = "active";
    activeTag.value = null;
  });

  afterEach(() => {
    stopRouter();
    resetUrl();
    activeView.value = "active";
    activeTag.value = null;
  });

  it("hydrates signals from the initial URL path", () => {
    history.replaceState(null, "", "/archived");
    initRouter();
    expect(activeView.value).toBe("archived");
    expect(activeTag.value).toBeNull();
  });

  it("hydrates a tag sub-route", () => {
    history.replaceState(null, "", "/tags/work");
    initRouter();
    expect(activeView.value).toBe("tags");
    expect(activeTag.value).toBe("work");
  });

  it("leaves signals alone on an unknown path", () => {
    activeView.value = "trash";
    history.replaceState(null, "", "/bogus");
    initRouter();
    expect(activeView.value).toBe("trash");
  });

  it("pushes a new history entry when the view changes", () => {
    initRouter();
    const before = history.length;
    activeView.value = "archived";
    expect(window.location.pathname).toBe("/archived");
    expect(history.length).toBe(before + 1);
  });

  it("writes the tag to the URL", () => {
    initRouter();
    activeView.value = "tags";
    activeTag.value = "work";
    expect(window.location.pathname).toBe("/tags/work");
  });

  it("returns to the root for the active view", () => {
    history.replaceState(null, "", "/archived");
    initRouter();
    expect(window.location.pathname).toBe("/archived");
    activeView.value = "active";
    expect(window.location.pathname).toBe("/");
  });

  it("updates signals on popstate events", () => {
    initRouter();
    history.replaceState(null, "", "/trash");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(activeView.value).toBe("trash");
  });

  it("is idempotent when called twice", () => {
    initRouter();
    initRouter();
    activeView.value = "archived";
    expect(window.location.pathname).toBe("/archived");
  });
});
