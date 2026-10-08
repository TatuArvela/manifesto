import { describe, expect, it } from "vitest";
import { subjectOf } from "./sender.js";

describe("subjectOf", () => {
  it("names the client's address when it is https", () => {
    expect(
      subjectOf({ appUrl: "https://notes.example", corsOrigins: [] }),
    ).toBe("https://notes.example");
  });

  it("passes over an http address, which a push service refuses", () => {
    expect(
      subjectOf({
        appUrl: "http://localhost:5173",
        corsOrigins: ["http://192.168.1.4", "https://notes.example"],
      }),
    ).toBe("https://notes.example");
    expect(
      subjectOf({ appUrl: "http://localhost:5173", corsOrigins: [] }),
    ).toMatch(/^mailto:/);
  });

  it("gives a placeholder when the server knows no address", () => {
    expect(subjectOf({ appUrl: null, corsOrigins: [] })).toMatch(/^mailto:/);
  });
});
