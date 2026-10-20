import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * Release-please writes this file again in each release commit and in no other
 * commit. Thus, the last commit that changes it is the release that
 * `package.json` names.
 */
const RELEASE_MANIFEST = ".release-please-manifest.json";

export interface BuildVersionOptions {
  /**
   * The repository root: the directory that contains the root `package.json`.
   */
  root: string;
  env?: Record<string, string | undefined>;
}

/**
 * The version that a build must report: `0.1.5` for the release commit itself,
 * and `0.1.5+14.bf5a6dd` for the fourteenth commit after it. The suffix is
 * semver build metadata. A `-` would make it a prerelease, which sorts *before*
 * 0.1.5.
 *
 * The distance is counted from the last release commit, not from a tag. The
 * Release workflow creates the tag while the Pages build of the same push
 * already runs. Thus, the build would usually miss it.
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
  // `.git`), or `root` inside an unrelated repository. Nothing here tells which
  // commit this is. Thus, the release number is all that we have.
  try {
    if (git("rev-parse", "--show-toplevel") !== realpathSync(root)) {
      return version;
    }
  } catch {
    return version;
  }

  // A tag checkout can be shallow, and the tag alone is sufficient.
  if (git("tag", "--points-at", "HEAD").split("\n").includes(`v${version}`)) {
    return version;
  }

  const sha = git("rev-parse", "--short", "HEAD");

  // In a shallow clone, the oldest loaded commit seems to add each file. Thus,
  // the manifest would seem to change at that commit, and the distance would be
  // zero: a false release. Tell which commit it is in place of that.
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    return `${version}+${sha}`;
  }

  const release = git("log", "-1", "--format=%H", "--", RELEASE_MANIFEST);
  if (!release) return `${version}+${sha}`;

  const distance = Number(git("rev-list", "--count", `${release}..HEAD`));
  return distance === 0 ? version : `${version}+${distance}.${sha}`;
}
