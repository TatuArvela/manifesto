import { logger } from "#/lib/logger.ts";
import { startPeriodicJob } from "#/lib/periodic.ts";
import { nowIso } from "#/lib/time.ts";
import { safeFetch } from "#/linkPreview/safeFetch.ts";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export interface UpdateStatus {
  /** The newest release, as `1.2.3`. */
  latest: string;
  /** Its page, for the notes about the changes. */
  url: string;
  checkedAt: string;
  /** If it is newer than the running version. */
  available: boolean;
}

/** `1.2.3` from `v1.2.3`, `1.2.3+14.abc` or `1.2.3`. Null if it is none. */
export function releaseCore(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/**
 * If `latest` is a newer release than `running`. A build after a release
 * (`0.1.8+14.bf5a6dd`) counts as that release. It is after it, not before. Only
 * a later release is news.
 */
export function isNewer(latest: string, running: string): boolean {
  const a = releaseCore(latest);
  const b = releaseCore(running);
  if (!a || !b) return false;
  for (const [i, part] of a.entries()) {
    const other = b[i] ?? 0;
    if (part !== other) return part > other;
  }
  return false;
}

export interface UpdateChecker {
  status(): UpdateStatus | null;
  stop(): void;
}

/**
 * Asks GitHub for the newest release of `repo` two times each day. Thus, the
 * admin overview can tell when there is one. It is one request to a public API,
 * through the same outbound boundary as link previews. To stop it, set
 * `UPDATE_CHECK=off`. A failed check keeps the last answer.
 */
export function startUpdateCheck(
  repo: string,
  running: string,
  fetchLatest: (
    repo: string,
  ) => Promise<{ tag: string; url: string }> = fetchLatestRelease,
): UpdateChecker {
  let current: UpdateStatus | null = null;
  const stop = startPeriodicJob("update check", TWELVE_HOURS_MS, async () => {
    const { tag, url } = await fetchLatest(repo);
    const core = releaseCore(tag);
    if (!core) {
      logger.warn("Newest release has an unexpected tag", { tag });
      return;
    }
    const latest = core.join(".");
    current = {
      latest,
      url,
      checkedAt: nowIso(),
      available: isNewer(latest, running),
    };
  });
  return { status: () => current, stop };
}

async function fetchLatestRelease(
  repo: string,
): Promise<{ tag: string; url: string }> {
  const res = await safeFetch(
    new URL(`https://api.github.com/repos/${repo}/releases/latest`),
    {
      accept: "application/vnd.github+json",
      maxBytes: 512 * 1024,
      overflow: "refuse",
      timeoutMs: 10_000,
      headers: { "User-Agent": "ManifestoUpdateCheck/1.0" },
    },
  );
  const body = JSON.parse(res.body.toString("utf8")) as {
    tag_name?: unknown;
    html_url?: unknown;
  };
  if (typeof body.tag_name !== "string") throw new Error("No tag in release");
  return {
    tag: body.tag_name,
    url:
      typeof body.html_url === "string"
        ? body.html_url
        : `https://github.com/${repo}/releases`,
  };
}
