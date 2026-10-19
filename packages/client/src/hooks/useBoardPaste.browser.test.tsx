import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { incomingShare } from "#/state/incomingShare.ts";
import { activeTag, activeView } from "#/state/ui.ts";
import { useBoardPaste } from "./useBoardPaste.ts";

let host: HTMLDivElement;

function Paster() {
  useBoardPaste();
  return null;
}

function paste(target: EventTarget, text: string) {
  const data = new DataTransfer();
  data.setData("text/plain", text);
  const event = new ClipboardEvent("paste", {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("a paste on the board", () => {
  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    // Through `act`, so the listener is in place before the first paste.
    await act(() => render(<Paster />, host));
    incomingShare.value = null;
    activeView.value = "active";
    activeTag.value = null;
  });
  afterEach(() => {
    render(null, host);
    host.remove();
    incomingShare.value = null;
    activeView.value = "active";
    activeTag.value = null;
  });

  it("starts a new note holding the text", async () => {
    const event = paste(document.body, "  Buy milk  ");
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(incomingShare.value).toEqual({
        title: "",
        content: "Buy milk",
        images: [],
      }),
    );
  });

  it("goes to the notes view from another, and keeps a tag already there", async () => {
    activeView.value = "archived";
    paste(document.body, "From the archive");
    await vi.waitFor(() => expect(incomingShare.value).not.toBeNull());
    expect(activeView.value).toBe("active");

    incomingShare.value = null;
    activeTag.value = "work";
    paste(document.body, "Under a tag");
    await vi.waitFor(() => expect(incomingShare.value).not.toBeNull());
    expect(activeTag.value).toBe("work");
  });

  it("leaves a paste into a field to the field", async () => {
    const field = document.createElement("input");
    host.appendChild(field);
    const event = paste(field, "typed");
    expect(event.defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(incomingShare.value).toBeNull();
  });

  it("leaves a paste to an open dialog", async () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    host.appendChild(dialog);
    const event = paste(document.body, "into the dialog");
    expect(event.defaultPrevented).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(incomingShare.value).toBeNull();
  });
});
