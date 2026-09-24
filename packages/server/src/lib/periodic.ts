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

/**
 * The longest delay a Node timer takes (2^31 - 1 ms, under 25 days). A longer
 * one is not refused but set to 1 ms, so a monthly job would run every
 * millisecond.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

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
  // An interval past the timer's limit is counted out in shorter ticks, each
  // running the job only once it is due. Only then: a tick can land a
  // millisecond before a wall-clock deadline, and for an ordinary interval
  // that would skip a whole run.
  const counted = intervalMs > MAX_TIMER_MS;
  let due = Date.now() + intervalMs;
  const handle = setInterval(
    () => {
      if (counted && Date.now() < due) return;
      due = Date.now() + intervalMs;
      void run();
    },
    Math.min(intervalMs, MAX_TIMER_MS),
  );
  if (typeof handle.unref === "function") handle.unref();
  return () => {
    clearInterval(handle);
    if (statuses.get(name) === status) statuses.delete(name);
  };
}
