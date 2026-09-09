import { logger } from "./logger.js";

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
  async function run(): Promise<void> {
    try {
      await job();
    } catch (err) {
      logger.error(`${name} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  void run();
  const handle = setInterval(() => {
    void run();
  }, intervalMs);
  if (typeof handle.unref === "function") handle.unref();
  return () => clearInterval(handle);
}
