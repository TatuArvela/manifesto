import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "./shutdown.js";

/**
 * Order and idempotency are the whole content of this module, so that is what
 * these check. Every step records its name in one list, which is the only way
 * to assert "storage closed last" as a fact rather than as a reading of the
 * source.
 */

function recorder() {
  const calls: string[] = [];
  const step = (name: string, delayMs = 0) => {
    calls.push(`${name}:start`);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        calls.push(name);
        resolve();
      }, delayMs);
    });
  };
  return { calls, step };
}

describe("createShutdown", () => {
  it("lets go in the order that keeps writes safe", async () => {
    // Where the server's own close lands depends on when its sockets end, so
    // that is the next test's subject; these four are ordered by what they
    // may still write. `closeServer` is left out rather than pinned to a
    // timing this does not care about.
    const { calls, step } = recorder();

    await createShutdown({
      destroyRealtime: () => step("realtime"),
      dropConnections: () => {
        calls.push("connections");
      },
      stopJobs: [
        () => {
          calls.push("job-a");
        },
        () => {
          calls.push("job-b");
        },
      ],
      closeStorage: () => step("storage"),
    })();

    expect(calls.filter((c) => !c.endsWith(":start"))).toEqual([
      "realtime",
      "connections",
      "job-a",
      "job-b",
      "storage",
    ]);
  });

  it("flushes realtime before closing storage", async () => {
    // Flushing a debounced Yjs document is a write. Closing the database
    // first would lose whatever was still in the 10s window.
    const { calls, step } = recorder();

    await createShutdown({
      destroyRealtime: () => step("realtime", 20),
      closeStorage: () => step("storage"),
    })();

    expect(calls).toEqual([
      "realtime:start",
      "realtime",
      "storage:start",
      "storage",
    ]);
  });

  it("does not wait for connections before doing what closes them", async () => {
    // `close()` calls back only when the open sockets are gone, and a
    // collaboration socket is open by design — so awaiting it before the
    // realtime teardown and the connection drop would stall the whole
    // shutdown until the timeout, with pending Yjs writes unflushed. This
    // `closeServer` resolves only once those have run, which is exactly the
    // deadlock the old order produced.
    const { calls, step } = recorder();
    let connectionsDropped = false;

    await createShutdown({
      closeServer: () =>
        new Promise<void>((resolve) => {
          calls.push("server:asked");
          const poll = setInterval(() => {
            if (connectionsDropped) {
              clearInterval(poll);
              calls.push("server");
              resolve();
            }
          }, 5);
        }),
      destroyRealtime: () => step("realtime"),
      dropConnections: () => {
        calls.push("connections");
        connectionsDropped = true;
      },
      closeStorage: () => step("storage"),
      timeoutMs: 2000,
    })();

    expect(calls.filter((c) => !c.endsWith(":start"))).toEqual([
      "server:asked",
      "realtime",
      "connections",
      "server",
      "storage",
    ]);
  });

  it("runs once however many times it is asked", async () => {
    // A container sends SIGTERM and then SIGINT; an impatient operator presses
    // Ctrl-C twice. Neither may start a second teardown over a half-finished
    // one.
    const closeStorage = vi.fn(async () => {});
    const shutdown = createShutdown({ closeStorage });

    await Promise.all([shutdown(), shutdown()]);
    await shutdown();

    expect(closeStorage).toHaveBeenCalledTimes(1);
  });

  it("closes storage even when an earlier step throws", async () => {
    // A database left open is worse than a socket that refused to close.
    const closeStorage = vi.fn(async () => {});

    await createShutdown({
      closeServer: async () => {
        throw new Error("still had connections");
      },
      destroyRealtime: async () => {
        throw new Error("hocuspocus said no");
      },
      closeStorage,
    })();

    expect(closeStorage).toHaveBeenCalledTimes(1);
  });

  it("keeps going when a job's stop function throws", async () => {
    const closeStorage = vi.fn(async () => {});

    await createShutdown({
      stopJobs: [
        () => {
          throw new Error("no");
        },
      ],
      closeStorage,
    })();

    expect(closeStorage).toHaveBeenCalledTimes(1);
  });

  it("gives up rather than hanging forever", async () => {
    // A socket that never closes must not hold the process past the runtime's
    // patience — SIGKILL at 30s in most containers.
    const shutdown = createShutdown({
      closeServer: () => new Promise<void>(() => {}),
      timeoutMs: 20,
    });

    await expect(shutdown()).resolves.toBeUndefined();
  });

  it("does nothing gracefully when given no steps", async () => {
    await expect(createShutdown({})()).resolves.toBeUndefined();
  });
});
