import { describe, expect, it } from "vitest";
import { namesMcp } from "./grants.ts";

describe("namesMcp", () => {
  it("names the MCP endpoint, and its address from before the API was versioned", () => {
    for (const resource of [
      "https://notes.example/api/v1/mcp",
      "https://notes.example/api/v1/mcp/",
      // What an assistant that connected before still asks for on a refresh.
      "https://notes.example/api/mcp",
    ]) {
      expect(namesMcp(resource), resource).toBe(true);
    }
  });

  it("names nothing else", () => {
    for (const resource of [
      "https://notes.example/api/v1/notes",
      "https://notes.example/mcp",
      "not a url",
    ]) {
      expect(namesMcp(resource), resource).toBe(false);
    }
  });
});
