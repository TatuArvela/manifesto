import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "./shutdown.ts";

/**
 * The order and the idempotency are all of the purpose of this module. Thus,
 * these tests check them. Each step records its name in one list. That is the
 * only way to assert "storage closed last" as a fact, not as a reading of the
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
    // When the own close of the server occurs depends on when its sockets end.
    // Thus, that is the subject of the next test. These four are in the order
    // of what they can still write. `closeServer` is not included, so that the
    // test does not depend on a timing that is not important here.
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
    // A flush of a debounced Yjs document is a write. If the database closed
    // first, the data that was still in the 10s window would be lost.
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
    // collaboration socket is open by design. If the code awaited it before the
    // realtime teardown and the drop of connections, the full shutdown would
    // stop until the timeout, with Yjs writes that did not flush. This
    // `closeServer` resolves only after those ran. That is exactly the deadlock
    // that the old order caused.
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
    // A container sends SIGTERM and then SIGINT. An impatient operator pushes
    // Ctrl-C two times. Neither must start a second teardown over a teardown
    // that is half complete.
    const closeStorage = vi.fn(async () => {});
    const shutdown = createShutdown({ closeStorage });

    await Promise.all([shutdown(), shutdown()]);
    await shutdown();

    expect(closeStorage).toHaveBeenCalledTimes(1);
  });

  it("closes storage even when an earlier step throws", async () => {
    // A database that stays open is worse than a socket that did not close.
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
    // A socket that never closes must not keep the process after the patience
    // of the runtime (SIGKILL at 30s in most containers).
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
