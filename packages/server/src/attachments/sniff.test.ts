import { describe, expect, it } from "vitest";
import { sniffImageType } from "./sniff.js";

const bytes = (...values: (number | string)[]) =>
  Uint8Array.from(
    values.flatMap((v) =>
      typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v],
    ),
  );

describe("sniffImageType", () => {
  it("knows each accepted type by its leading bytes", () => {
    expect(sniffImageType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      "image/png",
    );
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes("GIF89a"))).toBe("image/gif");
    expect(sniffImageType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe(
      "image/webp",
    );
    expect(sniffImageType(bytes(0, 0, 0, 0x1c, "ftypavif"))).toBe("image/avif");
  });

  it("knows nothing else", () => {
    expect(sniffImageType(bytes("<svg"))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});
