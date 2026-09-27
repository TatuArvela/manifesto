import { render } from "preact";
import { encode } from "uqr";
import { afterEach, describe, expect, it } from "vitest";
import { QrCode, qrPath } from "./QrCode.js";

const LINK =
  "otpauth://totp/Manifesto:alice?secret=JBSWY3DPEHPK3PXP&issuer=Manifesto&algorithm=SHA1&digits=6&period=30";

let container: HTMLElement;

afterEach(() => {
  render(null, container);
  container.remove();
});

async function drawn(): Promise<SVGSVGElement> {
  container = document.createElement("div");
  document.body.append(container);
  render(<QrCode value={LINK} label="QR code" />, container);
  await expect
    .poll(() => container.querySelector("path"), { timeout: 5000 })
    .not.toBeNull();
  return container.querySelector("svg") as SVGSVGElement;
}

describe("QrCode", () => {
  it("draws the value's modules, labelled for a screen reader", async () => {
    const svg = await drawn();
    const { data } = encode(LINK, { ecc: "M", border: 2 });
    expect(svg.getAttribute("viewBox")).toBe(
      `0 0 ${data.length} ${data.length}`,
    );
    expect(svg.querySelector("path")?.getAttribute("d")).toBe(qrPath(data));
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("QR code");
  });

  it("makes one unit square per dark module", () => {
    expect(
      qrPath([
        [true, false],
        [false, true],
      ]),
    ).toBe("M0 0h1v1h-1zM1 1h1v1h-1z");
  });
});
