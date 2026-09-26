import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The test build is open mode, where no one is an admin; the entry is about
// connected mode, so the server is switched on for this file.
vi.mock("../state/auth.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/auth.js")>()),
  isServerMode: true,
}));

const { currentUser } = await import("../state/auth.js");
// Whatever language an earlier test left the page in.
const { t } = await import("../i18n/index.js");
const { MobileNav, Sidebar } = await import("./Sidebar.js");

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
