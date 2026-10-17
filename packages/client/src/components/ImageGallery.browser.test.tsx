import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageGallery } from "./ImageGallery.tsx";

const PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const OTHER = `${PIXEL}#2`;

let container: HTMLElement;

function mount(node: preact.JSX.Element) {
  container = document.createElement("div");
  document.body.append(container);
  render(node, container);
}

afterEach(() => {
  render(null, container);
  container.remove();
});

const tick = () => new Promise((r) => requestAnimationFrame(r));

function button(name: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === name,
  );
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

describe("ImageGallery", () => {
  it("gives each image its description, and its open button the same", () => {
    mount(<ImageGallery images={[PIXEL, OTHER]} alts={["A red bicycle"]} />);
    const images = container.querySelectorAll("img");
    expect(images[0]?.getAttribute("alt")).toBe("A red bicycle");
    // An image nobody described is still named by its button.
    expect(images[1]?.getAttribute("alt")).toBe("");
    expect(button("Open image: A red bicycle")).toBeTruthy();
    expect(button("Open image")).toBeTruthy();
  });

  it("offers no description field where the images cannot change", async () => {
    mount(<ImageGallery images={[PIXEL]} alts={["A cat"]} />);
    button("Open image: A cat").click();
    await tick();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.querySelector("img")?.getAttribute("alt")).toBe("A cat");
    expect(dialog?.querySelector("textarea")).toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
  });

  it("saves a description written in the viewer when it closes", async () => {
    const onDescribe = vi.fn();
    mount(
      <ImageGallery
        images={[PIXEL, OTHER]}
        onDescribe={onDescribe}
        onDelete={() => {}}
      />,
    );
    button("Describe image").click();
    await tick();
    const field = document.querySelector<HTMLTextAreaElement>(
      '[role="dialog"] textarea',
    );
    if (!field) throw new Error("No description field");
    // "Describe image" goes straight to the field, which has a name.
    expect(document.activeElement).toBe(field);
    expect(field.labels?.[0]?.textContent).toBe("Image description");
    field.value = "  A red bicycle ";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    // The arrows move the caret here, not to the next image.
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await tick();
    expect(document.querySelector('[role="dialog"] textarea')).toBe(field);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onDescribe).toHaveBeenCalledOnce();
    expect(onDescribe).toHaveBeenCalledWith(PIXEL, "A red bicycle");
  });

  it("does not write a description that did not change", async () => {
    const onDescribe = vi.fn();
    mount(
      <ImageGallery
        images={[PIXEL]}
        alts={["A cat"]}
        onDescribe={onDescribe}
      />,
    );
    button("Describe image").click();
    await tick();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await tick();
    expect(onDescribe).not.toHaveBeenCalled();
  });
});
