import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The test build is in open mode, where nobody is an admin. The entry is about
// connected mode. Thus, this file switches the server on.
vi.mock("#/state/account/auth.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/state/account/auth.ts")>()),
  isServerMode: true,
}));

const { currentUser } = await import("#/state/account/auth.ts");
// The language that an earlier test left on the page.
const { t } = await import("#/i18n/index.ts");
const { MobileNav, Sidebar } = await import("./Sidebar.tsx");

let host: HTMLDivElement;

function labels(): (string | null)[] {
  return [...host.querySelectorAll("button")].map((b) =>
    b.getAttribute("aria-label"),
  );
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  currentUser.value = null;
});

const user = {
  id: "u",
  username: "u",
  displayName: "U",
  avatarColor: "#000",
  email: null,
};

describe("the Users entry", () => {
  for (const [name, Nav] of [
    ["side menu", Sidebar],
    ["phone's top row", MobileNav],
  ] as const) {
    it(`ends the ${name} for an admin`, () => {
      currentUser.value = { ...user, isAdmin: true };
      render(<Nav />, host);
      expect(labels().at(-1)).toBe(t("nav.admin"));
    });

    it(`is not in the ${name} for anyone else`, () => {
      currentUser.value = { ...user, isAdmin: false };
      render(<Nav />, host);
      expect(labels()).not.toContain(t("nav.admin"));
    });
  }
});
