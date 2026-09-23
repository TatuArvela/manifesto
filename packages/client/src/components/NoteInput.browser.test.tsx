import type { LinkPreview } from "@manifesto/shared";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n/index.js";
import { incomingShare } from "../state/incomingShare.js";
import { activeView, noteQuips, notes } from "../state/index.js";
import { LocalStorageAdapter } from "../storage/index.js";
import { NoteInput } from "./NoteInput.js";

/**
 * `noteQuips` was persisted and never read: the setting saved, survived a
 * reload and changed nothing, because the composer's stack always drew from
 * the rotation. `cta.plain` sat in both catalogues with no caller.
 */

let host: HTMLDivElement;

/** The two sheets of the stack: the top one and the one showing behind it. */
function stackLines(): string[] {
  return [...host.querySelectorAll(".note-stack > div > div > div")].map(
    (el) => el.textContent?.trim() ?? "",
  );
}

describe("NoteInput quips", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    activeView.value = "active";
    noteQuips.value = true;
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    noteQuips.value = true;
  });

  it("draws the stack from the quip rotation while the preference is on", () => {
    render(<NoteInput />, host);
    const lines = stackLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines).not.toContain(t("cta.plain"));
  });

  it("shows the plain line on both sheets with the preference off", () => {
    noteQuips.value = false;
    render(<NoteInput />, host);
    const lines = stackLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toBe(t("cta.plain"));
  });

  it("switches the stack already on screen when the preference changes", () => {
    render(<NoteInput />, host);
    expect(stackLines()).not.toContain(t("cta.plain"));

    noteQuips.value = false;
    render(<NoteInput />, host);
    for (const line of stackLines()) expect(line).toBe(t("cta.plain"));
  });
});

describe("NoteInput with an empty draft", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    activeView.value = "active";
    render(<NoteInput />, host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    localStorage.clear();
    notes.value = [];
  });

  async function openEmptyDraft(): Promise<HTMLElement> {
    (host.querySelector(".note-stack") as HTMLElement).click();
    return await vi.waitFor(() => {
      const done = document.querySelector<HTMLElement>(
        `[role="dialog"] button[aria-label="${t("editor.done")}"]`,
      );
      expect(done).toBeTruthy();
      return done as HTMLElement;
    });
  }

  it("adds an empty note when Done is pressed", async () => {
    // Done is an explicit request for a note; an empty one used to be
    // discarded as silently as a pad opened by accident.
    const done = await openEmptyDraft();
    done.click();
    await vi.waitFor(() => expect(notes.value).toHaveLength(1));
    expect(notes.value[0]).toMatchObject({ title: "", content: "" });
  });

  it("still discards an empty draft closed with Escape", async () => {
    await openEmptyDraft();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    expect(notes.value).toHaveLength(0);
  });
});

describe("NoteInput focus on a phone", () => {
  // Chromium has no soft keyboard, so these follow focus instead. iOS keeps the
  // keyboard up only while focus goes from one text field to another, and
  // raises it for any text field focused inside a gesture.
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    activeView.value = "active";
    render(<NoteInput />, host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    localStorage.clear();
    notes.value = [];
  });

  const editorHasFocus = () =>
    expect(document.activeElement?.closest(".ProseMirror")).toBeTruthy();

  it("hands focus from the tap straight to the editor", async () => {
    // The focus trap moved focus onto the editor's first button while Milkdown
    // was still building, which put the keyboard away before the editor asked.
    const focused: Element[] = [];
    const record = (e: FocusEvent) => focused.push(e.target as Element);
    document.addEventListener("focusin", record);
    try {
      host
        .querySelector<HTMLElement>(`button[aria-label="${t("nav.newNote")}"]`)
        ?.click();
      await vi.waitFor(editorHasFocus);
    } finally {
      document.removeEventListener("focusin", record);
    }
    const outsideEditor = focused.filter((el) => !el.closest(".ProseMirror"));
    expect(outsideEditor.map((el) => el.tagName)).toEqual(["INPUT"]);
  });

  it("does not give focus back to the keyboard primer on close", async () => {
    // It did, and that raised the keyboard as the editor went away.
    host
      .querySelector<HTMLElement>(`button[aria-label="${t("nav.newNote")}"]`)
      ?.click();
    await vi.waitFor(editorHasFocus);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await vi.waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toBeNull(),
    );
    expect(document.activeElement?.tagName).not.toBe("INPUT");
  });
});

describe("NoteInput link previews", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    activeView.value = "active";
    render(<NoteInput />, host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    render(null, host);
    host.remove();
    localStorage.clear();
    notes.value = [];
  });

  async function openDraft() {
    (host.querySelector(".note-stack") as HTMLElement).click();
    return await vi.waitFor(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      const body = dialog?.querySelector<HTMLElement>(".ProseMirror");
      const title = dialog?.querySelector<HTMLInputElement>(
        `input[placeholder="${t("editor.titlePlaceholder")}"]`,
      );
      expect(body).toBeTruthy();
      expect(title).toBeTruthy();
      return {
        dialog: dialog as HTMLElement,
        body: body as HTMLElement,
        title: title as HTMLInputElement,
      };
    });
  }

  function paste(target: HTMLElement, text: string) {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    target.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  }

  const cardDomains = (dialog: HTMLElement) =>
    [...dialog.querySelectorAll(".group\\/lp .truncate + .truncate")].map(
      (el) => el.textContent,
    );

  it("adds a card for every link pasted into the body, and none for the title", async () => {
    const { dialog, body, title } = await openDraft();

    paste(title, "https://title.test");
    paste(body, "see https://a.test and https://b.test");

    await vi.waitFor(() =>
      expect(cardDomains(dialog)).toEqual(["a.test", "b.test"]),
    );
  });

  it("fills in the saved note when its preview arrives after closing", async () => {
    let answer: (preview: LinkPreview) => void = () => {};
    vi.spyOn(LocalStorageAdapter.prototype, "fetchLinkPreview").mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { dialog, body } = await openDraft();
    paste(body, "https://slow.test");
    await vi.waitFor(() => expect(cardDomains(dialog)).toEqual(["slow.test"]));

    (
      dialog.querySelector(
        `button[aria-label="${t("editor.done")}"]`,
      ) as HTMLElement
    ).click();
    await vi.waitFor(() => expect(notes.value).toHaveLength(1));
    expect(notes.value[0].linkPreviews[0].title).toBe("https://slow.test");

    answer({
      url: "https://slow.test",
      title: "Slow page",
      domain: "slow.test",
    });

    await vi.waitFor(() =>
      expect(notes.value[0].linkPreviews[0].title).toBe("Slow page"),
    );
  });
});

describe("NoteInput width", () => {
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    render(null, host);
    host.remove();
    activeView.value = "active";
  });

  it("measures its column on arriving from a view where it rendered nothing", async () => {
    // `App` keeps the composer mounted in the archive view, where it renders
    // nothing. Mounted there and then shown, it used to keep no width at all
    // and stretch across every column.
    activeView.value = "archived";
    render(<NoteInput />, host);
    expect(host.querySelector(".note-stack")).toBeNull();

    activeView.value = "active";
    await vi.waitFor(() => {
      const wrapper = host.querySelector(".note-stack")?.parentElement;
      expect(wrapper?.style.width).toMatch(/^\d+(\.\d+)?px$/);
    });
  });
});

describe("NoteInput with something shared to the app", () => {
  beforeEach(() => {
    localStorage.clear();
    notes.value = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    activeView.value = "active";
  });

  afterEach(() => {
    incomingShare.value = null;
    render(null, host);
    host.remove();
    localStorage.clear();
    notes.value = [];
  });

  it("opens the editor with the share and saves it as a note", async () => {
    incomingShare.value = {
      title: "Shared page",
      content: "A quote\n\nhttps://example.com/a",
      images: [],
    };
    render(<NoteInput />, host);
    const done = await vi.waitFor(() => {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog?.querySelector(".ProseMirror")?.textContent).toContain(
        "A quote",
      );
      const title = dialog?.querySelector<HTMLInputElement>(
        `input[placeholder="${t("editor.titlePlaceholder")}"]`,
      );
      expect(title?.value).toBe("Shared page");
      return dialog?.querySelector<HTMLElement>(
        `button[aria-label="${t("editor.done")}"]`,
      ) as HTMLElement;
    });
    expect(incomingShare.value).toBeNull();
    done.click();
    await vi.waitFor(() => expect(notes.value).toHaveLength(1));
    expect(notes.value[0].title).toBe("Shared page");
    expect(notes.value[0].linkPreviews.map((p) => p.url)).toEqual([
      "https://example.com/a",
    ]);
  });
});
