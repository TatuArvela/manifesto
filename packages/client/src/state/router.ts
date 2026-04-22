import { effect } from "@preact/signals";
import { type AppView, activeTag, activeView } from "./ui.js";

export interface Route {
  view: AppView;
  tag: string | null;
}

/** Vite's `BASE_URL` (e.g. `/` in dev, `/manifesto/` on GitHub Pages). */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const VIEW_PATHS: Record<AppView, string> = {
  active: "/",
  tags: "/tags",
  reminders: "/reminders",
  archived: "/archived",
  trash: "/trash",
};

const PATH_TO_VIEW: Record<string, AppView> = {
  "/": "active",
  "/tags": "tags",
  "/reminders": "reminders",
  "/archived": "archived",
  "/trash": "trash",
};

function stripBase(pathname: string): string {
  if (BASE && pathname.startsWith(BASE)) {
    const rest = pathname.slice(BASE.length);
    return rest === "" ? "/" : rest;
  }
  return pathname || "/";
}

/** Parse a URL pathname into a route, or null if the path isn't recognized. */
export function parsePath(pathname: string): Route | null {
  const path = stripBase(pathname);
  if (path === "/") return { view: "active", tag: null };
  if (path.startsWith("/tags/")) {
    const encoded = path.slice("/tags/".length);
    if (!encoded) return { view: "tags", tag: null };
    try {
      return { view: "tags", tag: decodeURIComponent(encoded) };
    } catch {
      return null;
    }
  }
  const view = PATH_TO_VIEW[path];
  if (!view) return null;
  return { view, tag: null };
}

/** Serialize a route into a full URL pathname (base-prefixed). */
export function buildPath(route: Route): string {
  if (route.view === "tags" && route.tag) {
    return `${BASE}/tags/${encodeURIComponent(route.tag)}`;
  }
  const sub = VIEW_PATHS[route.view];
  if (sub === "/") return BASE === "" ? "/" : `${BASE}/`;
  return `${BASE}${sub}`;
}

let disposeEffect: (() => void) | null = null;
let popListener: (() => void) | null = null;

/**
 * Sync `activeView` and `activeTag` with `location.pathname`. Safe to call
 * multiple times — subsequent calls are no-ops. Returns a cleanup function
 * primarily intended for tests.
 */
export function initRouter(): () => void {
  if (disposeEffect) return stopRouter;

  const initial = parsePath(window.location.pathname);
  if (initial) {
    activeView.value = initial.view;
    activeTag.value = initial.tag;
  }

  let hydrated = false;
  disposeEffect = effect(() => {
    const next = buildPath({ view: activeView.value, tag: activeTag.value });
    if (!hydrated) {
      hydrated = true;
      return;
    }
    if (window.location.pathname === next) return;
    history.pushState(null, "", next);
  });

  popListener = () => {
    const parsed = parsePath(window.location.pathname);
    if (!parsed) return;
    activeView.value = parsed.view;
    activeTag.value = parsed.tag;
  };
  window.addEventListener("popstate", popListener);

  return stopRouter;
}

export function stopRouter() {
  if (disposeEffect) {
    disposeEffect();
    disposeEffect = null;
  }
  if (popListener) {
    window.removeEventListener("popstate", popListener);
    popListener = null;
  }
}
