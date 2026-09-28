import { readFileSync } from "node:fs";
import { NoteColor } from "@manifesto/shared";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "./tools.js";

/**
 * The agent skill in `skills/manifesto/` teaches an assistant these tools, so
 * it ships with them and is held to them here: a tool added, renamed or
 * removed, or a colour changed, fails this until the skill says the same.
 */
const skill = readFileSync(
  new URL("../../../../skills/manifesto/SKILL.md", import.meta.url),
  "utf8",
);

const toolNames = MCP_TOOLS.map((tool) => tool.name);

describe("the agent skill", () => {
  it("is named after its folder", () => {
    expect(skill).toMatch(/^---\nname: manifesto\ndescription: .+\n---\n/);
  });

  it("names every tool, in its description as well as its body", () => {
    const description = skill.match(/^description: (.+)$/m)?.[1] ?? "";
    for (const name of toolNames) {
      expect(description).toContain(name);
      expect(skill).toContain(`\`${name}\``);
    }
  });

  it("names no tool that does not exist", () => {
    const named = new Set(
      [...skill.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1]),
    );
    for (const name of named) expect(toolNames).toContain(name);
  });

  it("lists exactly the colours a note can have", () => {
    const line = skill.match(/^- \*\*color\*\*: ([\s\S]+?)\n- /m)?.[1] ?? "";
    const listed = [...line.matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
    expect(listed.sort()).toEqual(Object.values(NoteColor).sort());
  });
});
