import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openPostgres, type PgPool } from "./database.ts";

describe("openPostgres", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("survives a connection that dies while idle", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = new EventEmitter();
    const pool = openPostgres({
      connectionString: "postgres://unused",
      poolFactory: () => fake as unknown as PgPool,
    });

    // With no listener, `emit("error")` throws. That stopped the process.
    expect(() =>
      pool.emit("error", new Error("terminating connection"), {} as never),
    ).not.toThrow();
    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain(
      "terminating connection",
    );
  });
});
