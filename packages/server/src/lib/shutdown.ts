import { logger } from "./logger.js";

/**
 * The pieces a running server holds open, in the order they have to be let go
 * of. Each is optional so a test (or a future entrypoint that wires less than
 * `index.ts` does) can supply only what it has.
 */
export interface ShutdownSteps {
  /** Stop accepting new connections. Existing ones are dropped afterwards. */
  closeServer?: () => Promise<void>;
  /** Drop connections the server is still holding, once nothing is in flight. */
  dropConnections?: () => void;
  /** Flush pending Yjs stores and close collaboration sockets. */
  destroyRealtime?: () => Promise<void>;
  /** Stop the background sweeps. */
  stopJobs?: Array<() => void>;
  /** Close the database last, since everything above may still write. */
  closeStorage?: () => Promise<void>;
}

export interface ShutdownOptions extends ShutdownSteps {
  /**
   * How long the whole sequence may take before the process is abandoned.
   * Hocuspocus debounces persistence up to 10s, so this has to clear that with
   * room to spare, and it still has to be under the 30s a container runtime
   * typically allows between SIGTERM and SIGKILL.
   */
  timeoutMs?: number;
}

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

/**
 * Builds the shutdown routine. Returns a function that runs the sequence once,
 * however many times it is called: a container that sends SIGTERM and then
 * SIGINT, or an impatient operator pressing Ctrl-C twice, must not start a
 * second teardown over a half-finished one.
 *
 * Order is the whole point. Realtime is torn down before storage because
 * flushing a debounced Yjs document is a write, and the background sweeps are
 * stopped before storage for the same reason. The server is *asked* to close
 * first but not waited on until after the connections are gone: `close()`
 * refuses new connections at once and calls back only when the open ones end,
 * and a collaboration socket is open by design.
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
    // Started, not awaited: `close()` stops new connections immediately but
    // only calls back once the open ones are gone, and a collaboration socket
    // is open by design. Awaiting here would stall the two steps that are
    // what make those sockets go away, and the whole shutdown would sit until
    // the timeout with pending Yjs writes unflushed.
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
    // A step that fails must not strand the ones after it: a database left
    // open is worse than a socket that refused to close.
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
