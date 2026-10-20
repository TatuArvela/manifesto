import { logger } from "./logger.ts";

export interface JobStatus {
  name: string;
  intervalMs: number;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastDurationMs: number | null;
  /** The error of the last run, or null when it was successful. */
  lastError: string | null;
  running: boolean;
}

/**
 * Each job started in this process, and the result of its last run, for the
 * admin overview. It is in memory. It describes this process since its start,
 * which is what "is the cleanup running" asks.
 */
const statuses = new Map<string, JobStatus>();

/**
 * The longest delay that a Node timer accepts (2^31 - 1 ms, less than 25 days).
 * Node does not refuse a longer delay, but sets it to 1 ms. Thus, a monthly job
 * would run each millisecond.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

export function jobStatuses(): JobStatus[] {
  return [...statuses.values()].map((status) => ({ ...status }));
}

/**
 * Runs `job` one time now, and then each `intervalMs` until the caller calls
 * the returned stop function.
 *
 * Each background sweep in the server needs the same three things. If a caller
 * forgets one, it is a bug:
 *
 * - Failures are caught and logged. Thus, one bad run does not stop the timer,
 *   and does not stop the process with an unhandled rejection.
 * - The handle is unref'd. Thus, a sweep never keeps the process open.
 * - The first run occurs immediately. Thus, after a restart, expired rows do
 *   not stay for an hour.
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
  // An interval longer than the limit of the timer is counted in shorter ticks.
  // Each tick runs the job only when it is due, and only then. A tick can occur
  // one millisecond before a wall-clock deadline, and for a usual interval that
  // would skip a full run.
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
