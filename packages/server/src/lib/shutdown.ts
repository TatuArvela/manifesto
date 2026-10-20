import { logger } from "./logger.ts";

/**
 * The parts that a running server keeps open, in the order in which it must
 * release them. Each one is optional. Thus, a test (or a future entrypoint that
 * connects less than `index.ts`) can give only what it has.
 */
export interface ShutdownSteps {
  /**
   * Stop the acceptance of new connections. Existing connections drop after
   * that.
   */
  closeServer?: () => Promise<void>;
  /**
   * Drop the connections that the server still has, when nothing is in
   * progress.
   */
  dropConnections?: () => void;
  /** Flush waiting Yjs stores, and close collaboration sockets. */
  destroyRealtime?: () => Promise<void>;
  /** Stop the background sweeps. */
  stopJobs?: Array<() => void>;
  /** Close the database last, because all of the above can still write. */
  closeStorage?: () => Promise<void>;
}

export interface ShutdownOptions extends ShutdownSteps {
  /**
   * The maximum duration of the full sequence before the process is abandoned.
   * Hocuspocus debounces persistence up to 10s. Thus, this must be longer than
   * that, with spare time. It must still be less than the 30s that a container
   * runtime usually permits between SIGTERM and SIGKILL.
   */
  timeoutMs?: number;
}

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Builds the shutdown routine. Returns a function that runs the sequence one
 * time, however many times a caller calls it. A container that sends SIGTERM
 * and then SIGINT, or an impatient operator who pushes Ctrl-C two times, must
 * not start a second teardown over a teardown that is half complete.
 *
 * The order is the purpose. Realtime is torn down before storage, because a
 * flush of a debounced Yjs document is a write. The background sweeps stop
 * before storage for the same reason. The code *asks* the server to close
 * first, but does not wait for it until after the connections are gone.
 * `close()` refuses new connections immediately, and calls back only when the
 * open connections end. A collaboration socket is open by design.
 */
export function createShutdown(options: ShutdownOptions): () => Promise<void> {
  const {
    closeServer,
    dropConnections,
    destroyRealtime,
    stopJobs = [],
    closeStorage,
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  } = options;

  let running: Promise<void> | null = null;

  async function sequence(): Promise<void> {
    // Started, but not awaited. `close()` stops new connections immediately,
    // but calls back only after the open connections are gone, and a
    // collaboration socket is open by design. If the code awaited here, the two
    // steps that make those sockets go away would stop. The full shutdown would
    // then wait until the timeout, with Yjs writes that did not flush.
    const closed = closeServer?.().catch((err) => {
      logFailure("close server", err);
    });
    await step("destroy realtime", async () => destroyRealtime?.());
    dropConnections?.();
    await closed;
    for (const stop of stopJobs) {
      try {
        stop();
      } catch (err) {
        logFailure("stop job", err);
      }
    }
    await step("close storage", closeStorage);
  }

  return () => {
    if (!running) {
      logger.info("Shutting down");
      running = withTimeout(sequence(), timeoutMs).then(() => {
        logger.info("Shutdown complete");
      });
    }
    return running;
  };
}

async function step(name: string, run?: () => Promise<void>): Promise<void> {
  if (!run) return;
  try {
    await run();
  } catch (err) {
    // A step that fails must not stop the steps after it. A database that stays
    // open is worse than a socket that did not close.
    logFailure(name, err);
  }
}

function logFailure(name: string, err: unknown) {
  logger.error(`Shutdown step failed: ${name}`, {
    error: err instanceof Error ? err.message : String(err),
  });
}

async function withTimeout(work: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expiry = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      logger.error("Shutdown timed out; exiting anyway", { timeoutMs: ms });
      resolve();
    }, ms);
    if (typeof timer.unref === "function") timer.unref();
  });
  try {
    await Promise.race([work, expiry]);
  } finally {
    clearTimeout(timer);
  }
}
