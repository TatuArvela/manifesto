import { effect } from "@preact/signals";
import { afterHistorySettles } from "./sheetHistory.ts";
import { type AppView, activeTag, activeView } from "./ui.ts";

export interface Route {
  view: AppView;
  tag: string | null;
}

/**
 * The `BASE_URL` of Vite (for example `/` in dev, `/manifesto/` on GitHub
 * Pages).
 */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const VIEW_PATHS: Record<AppView, string> = {
  active: "/",
  tags: "/tags",
  reminders: "/reminders",
  autoNotes: "/auto-notes",
  archived: "/archived",
  trash: "/trash",
  search: "/search",
  admin: "/admin",
};

const PATH_TO_VIEW: Record<string, AppView> = {
  "/": "active",
  "/tags": "tags",
  "/reminders": "reminders",
  "/auto-notes": "autoNotes",
  "/archived": "archived",
  "/trash": "trash",
  "/search": "search",
  "/admin": "admin",
};

function stripBase(pathname: string): string {
  if (BASE && pathname.startsWith(BASE)) {
    const rest = pathname.slice(BASE.length);
    return rest === "" ? "/" : rest;
  }
  return pathname || "/";
}

/** Parse a URL pathname into a route, or null if the path is not known. */
export function parsePath(pathname: string): Route | null {
  const path = stripBase(pathname);
  if (path === "/") return { view: "active", tag: null };
  if (path.startsWith("/tags/")) {
    // A nested tag is its own path (`/tags/work/clients`), with each part
    // encoded separately. A link from before, with the full tag in one part
    // (`work%2Fclients`), decodes to the same tag.
    const parts = path.slice("/tags/".length).split("/").filter(Boolean);
    if (parts.length === 0) return { view: "tags", tag: null };
    try {
      return { view: "tags", tag: parts.map(decodeURIComponent).join("/") };
    } catch {
      return null;
    }
  }
  const view = PATH_TO_VIEW[path];
  if (!view) return null;
  return { view, tag: null };
}

/** Serialize a route into a full URL pathname (with the base prefix). */
export function buildPath(route: Route): string {
  if (route.view === "tags" && route.tag) {
    return `${BASE}/tags/${route.tag.split("/").map(encodeURIComponent).join("/")}`;
  }
  const sub = VIEW_PATHS[route.view];
  if (sub === "/") return BASE === "" ? "/" : `${BASE}/`;
  return `${BASE}${sub}`;
}

let disposeEffect: (() => void) | null = null;
let popListener: (() => void) | null = null;

/**
 * Sync `activeView` and `activeTag` with `location.pathname`. You can call it
 * many times. Later calls do nothing. Returns a cleanup function, mainly for
 * tests.
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
    // After the own `history.back()` of a sheet that closes. If not, that would
    // go back from this entry, not from its own.
    afterHistorySettles(() => {
      if (window.location.pathname !== next) history.pushState(null, "", next);
    });
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
