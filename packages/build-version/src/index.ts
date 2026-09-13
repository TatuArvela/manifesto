import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Release-please rewrites this file in every release commit and nowhere else,
 * so the last commit to touch it is the release that `package.json` names.
 */
const RELEASE_MANIFEST = ".release-please-manifest.json";

export interface BuildVersionOptions {
  /** The repository root: the directory holding the root `package.json`. */
  root: string;
  env?: Record<string, string | undefined>;
}

/**
 * The version a build should report: `0.1.5` for the release commit itself,
 * `0.1.5+14.bf5a6dd` for the fourteenth commit after it. The suffix is semver
 * build metadata; a `-` would make it a prerelease, which sorts *before* 0.1.5.
 *
 * The distance is counted from the last release commit rather than from a
 * tag, because the tag is created by the Release workflow while the Pages
 * build of that same push is already running, and would usually be missed.
 */
export function resolveBuildVersion({
  root,
  env = process.env,
}: BuildVersionOptions): string {
  const override = env.MANIFESTO_VERSION?.trim();
  if (override) return override;

  const { version } = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf-8"),
  ) as { version: string };

  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

  // No git, no repository (a source tarball, a Docker build context without
  // `.git`), or `root` sitting inside some unrelated repository: nothing here
  // says which commit this is, so the release number is all we have.
  try {
    if (git("rev-parse", "--show-toplevel") !== realpathSync(root)) {
      return version;
    }
  } catch {
    return version;
  }

  // A tag checkout can be shallow, and the tag is enough on its own.
  if (git("tag", "--points-at", "HEAD").split("\n").includes(`v${version}`)) {
    return version;
  }

  const sha = git("rev-parse", "--short", "HEAD");

  // In a shallow clone the oldest fetched commit appears to add every file,
  // so the manifest would seem to have changed right there and the distance
  // would read as zero: a false release. Say which commit it is instead.
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    return `${version}+${sha}`;
  }

  const release = git("log", "-1", "--format=%H", "--", RELEASE_MANIFEST);
  if (!release) return `${version}+${sha}`;

  const distance = Number(git("rev-list", "--count", `${release}..HEAD`));
  return distance === 0 ? version : `${version}+${distance}.${sha}`;
}
