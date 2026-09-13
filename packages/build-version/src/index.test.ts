import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveBuildVersion } from "./index.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "build-version-"));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** A repository shaped like ours, whose only commit is the release of `version`. */
function releasedRepo(version: string): string {
  const root = tempDir();
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "commit.gpgsign", "false");
  git(root, "config", "tag.gpgsign", "false");
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ version }));
  writeFileSync(
    path.join(root, ".release-please-manifest.json"),
    JSON.stringify({ ".": version }),
  );
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", `chore(main): release ${version}`);
  return root;
}

function commitAfter(root: string, name: string): void {
  writeFileSync(path.join(root, name), name);
  git(root, "add", name);
  git(root, "commit", "-q", "-m", `feat: ${name}`);
}

function shallowClone(root: string, ...args: string[]): string {
  const clone = path.join(tempDir(), "clone");
  git(
    root,
    "-c",
    "advice.detachedHead=false",
    "clone",
    "-q",
    "--depth",
    "1",
    ...args,
    `file://${root}`,
    clone,
  );
  return clone;
}

describe("resolveBuildVersion", () => {
  it("reports the plain version for the release commit, before its tag exists", () => {
    const root = releasedRepo("0.1.5");
    expect(resolveBuildVersion({ root, env: {} })).toBe("0.1.5");
  });

  it("counts the commits since the release and names the one built", () => {
    const root = releasedRepo("0.1.5");
    git(root, "tag", "v0.1.5");
    commitAfter(root, "a");
    commitAfter(root, "b");
    const sha = git(root, "rev-parse", "--short", "HEAD");
    expect(resolveBuildVersion({ root, env: {} })).toBe(`0.1.5+2.${sha}`);
  });

  it("trusts the release tag in a shallow checkout of it", () => {
    const root = releasedRepo("0.1.5");
    git(root, "tag", "v0.1.5");
    const clone = shallowClone(root, "--branch", "v0.1.5");
    expect(resolveBuildVersion({ root: clone, env: {} })).toBe("0.1.5");
  });

  it("does not mistake a shallow checkout past the release for the release", () => {
    const root = releasedRepo("0.1.5");
    commitAfter(root, "a");
    const clone = shallowClone(root);
    const sha = git(clone, "rev-parse", "--short", "HEAD");
    expect(resolveBuildVersion({ root: clone, env: {} })).toBe(`0.1.5+${sha}`);
  });

  it("falls back to the plain version outside a repository", () => {
    const root = tempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ version: "0.1.5" }),
    );
    expect(resolveBuildVersion({ root, env: {} })).toBe("0.1.5");
  });

  it("ignores an unrelated repository the sources happen to sit in", () => {
    const outer = releasedRepo("9.9.9");
    commitAfter(outer, "a");
    const root = path.join(outer, "unpacked");
    mkdirSync(root);
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ version: "0.1.5" }),
    );
    expect(resolveBuildVersion({ root, env: {} })).toBe("0.1.5");
  });

  it("uses MANIFESTO_VERSION verbatim when it is set", () => {
    const root = releasedRepo("0.1.5");
    commitAfter(root, "a");
    expect(
      resolveBuildVersion({
        root,
        env: { MANIFESTO_VERSION: "0.1.5+7.abc1234" },
      }),
    ).toBe("0.1.5+7.abc1234");
  });
});
