import { logger } from "./logger.js";

export interface JobStatus {
  name: string;
  intervalMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  /** The last run's error, or null when it went through. */
  lastError: string | null;
  running: boolean;
}

/**
 * Every job started in this process and how its last run went, for the admin
 * overview to show. In memory: it describes this process since it started,
 * which is what "is the cleanup running" asks.
 */
const statuses = new Map<string, JobStatus>();

export function jobStatuses(): JobStatus[] {
  return [...statuses.values()].map((status) => ({ ...status }));
}

/**
 * Runs `job` once now and then every `intervalMs` until the returned stop
 * function is called.
 *
 * Every background sweep in the server wants the same three things, and each
 * is a bug if a caller forgets it: failures are caught and logged, so one bad
 * run neither kills the timer nor takes the process down with an unhandled
 * rejection; the handle is unref'd, so a sweep never holds the process open;
 * and the first run happens immediately, so a restart doesn't leave expired
 * rows sitting for an hour.
 */
export function startPeriodicJob(
  name: string,
  intervalMs: number,
  job: () => Promise<void>,
): () => void {
  const status: JobStatus = {
    name,
    intervalMs,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastDurationMs: null,
    lastError: null,
    running: false,
  };
  statuses.set(name, status);

  async function run(): Promise<void> {
    const started = Date.now();
    status.running = true;
    status.lastStartedAt = new Date(started).toISOString();
    try {
      await job();
      status.lastError = null;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      status.lastError = message;
      logger.error(`${name} failed`, { error: message });
    } finally {
      status.running = false;
      status.lastFinishedAt = new Date().toISOString();
      status.lastDurationMs = Date.now() - started;
    }
  }

  void run();
  const handle = setInterval(() => {
    void run();
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return () => {
    clearInterval(handle);
    if (statuses.get(name) === status) statuses.delete(name);
  };
}
