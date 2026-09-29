// Checks pull request titles and commit subjects against the conventional
// commit shape release-please reads. A squash merge takes the PR title, or the
// commit subject when the PR has one commit, so both reach the changelog.
// These rules live here and nowhere else; the skills and templates point here.
//
//   node scripts/check-titles.mjs "feat(client): a title" ...
//   node scripts/check-titles.mjs --commits origin/main..HEAD
//   node scripts/check-titles.mjs --file .git/COMMIT_EDITMSG   (the commit-msg hook)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "perf", "refactor", "docs", "test", "build", "ci", "chore", "revert"];
const SCOPES = ["client", "server", "shared", "deps"];
// GitHub appends " (#123)" on merge, and the changelog line should still read as one line.
const MAX_LENGTH = 100;
const SHAPE = /^(?<type>[a-z]+)(?:\((?<scope>[a-z-]+)\))?!?: (?<description>.+)$/;

const RULES = `A title is "type(scope): description":
  type         ${TYPES.join(", ")}
               (feat and fix bump the version and reach the changelog)
  scope        optional: ${SCOPES.join(", ")}, only when one package is touched
  description  what the software now does, no full stop, no em dash
  length       at most ${MAX_LENGTH} characters`;

/** @param {string} title @returns {string[]} */
function problems(title) {
  // The Revert button's own wording; release-please understands it.
  if (/^Revert ".+"$/.test(title)) return [];
  const match = SHAPE.exec(title);
  if (!match?.groups) return ['not "type(scope): description"'];
  const found = [];
  const { type = "", scope, description = "" } = match.groups;
  if (!TYPES.includes(type)) found.push(`type "${type}" is not a known type`);
  if (scope !== undefined && !SCOPES.includes(scope)) {
    found.push(`scope "${scope}" is not a known scope (leave it out when several are touched)`);
  }
  if (description.startsWith(" ")) found.push("more than one space after the colon");
  if (description.endsWith(".")) found.push("ends with a full stop");
  if (title.includes("\u2014")) found.push("contains an em dash");
  if (title.length > MAX_LENGTH) found.push(`${title.length} characters, over ${MAX_LENGTH}`);
  return found;
}

/** The subject of a message file as git will store it: comments and leading blank lines dropped. */
function subjectOf(path) {
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((l) => l.trim() !== "" && !l.startsWith("#"));
  return line?.trim() ?? "";
}

const [mode, value] = process.argv.slice(2);
/** @type {string[]} */
let titles;
if (mode === "--commits") {
  const range = value ?? "origin/main..HEAD";
  titles = execFileSync("git", ["log", "--no-merges", "--format=%s", range], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line !== "");
} else if (mode === "--file" && value !== undefined) {
  const subject = subjectOf(value);
  // Merges, and fixups meant for `rebase --autosquash`, are let through here;
  // a fixup still on the branch at push time fails the CI run of --commits.
  const exempt = subject === "" || /^(Merge |fixup! |squash! |amend! )/.test(subject);
  titles = exempt ? [] : [subject];
} else {
  titles = process.argv.slice(2);
}

let failed = false;
for (const title of titles) {
  const found = problems(title);
  if (found.length === 0) continue;
  failed = true;
  console.error(`✗ ${title}`);
  for (const problem of found) console.error(`    ${problem}`);
}
if (failed) {
  console.error(`\n${RULES}`);
  process.exit(1);
}
