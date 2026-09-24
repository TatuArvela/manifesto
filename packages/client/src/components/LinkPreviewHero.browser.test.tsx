import { render } from "preact";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { forgetAttachmentUrls } from "../state/attachments.js";
import { currentStorage } from "../storage/index.js";
import { LinkPreviewHero } from "./LinkPreviewHero.js";

const REF = "attachment:01ARZ3NDEKTSV4RRFFQ69G5FAV";
const GIF_BYTES = Uint8Array.from(atob("R0lGODlhAQABAAAAACw="), (c) =>
  c.charCodeAt(0),
);

beforeEach(() => {
  forgetAttachmentUrls();
  vi.spyOn(currentStorage, "value", "get").mockReturnValue({
    loadImage: async () => new Blob([GIF_BYTES], { type: "image/gif" }),
    loadImages: async () => [],
  } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("draws a stored preview image from its bytes, not its reference", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  render(
    <LinkPreviewHero
      preview={{
        url: "https://a.test/",
        title: "A",
        image: REF,
        domain: "a.test",
      }}
    />,
    host,
  );
  await vi.waitFor(() => expect(host.querySelector("img")).not.toBeNull());
  expect(host.querySelector("img")?.src).toMatch(/^blob:/);
  render(null, host);
  host.remove();
});
