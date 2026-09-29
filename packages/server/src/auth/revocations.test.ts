import { describe, expect, it } from "vitest";
import {
  createSessionRevocations,
  type SessionRevocation,
} from "./revocations.js";

describe("session revocations", () => {
  it("tells every socket layer of a revocation, as it was given", () => {
    const revocations = createSessionRevocations();
    const heardByApp: SessionRevocation[] = [];
    const heardByYjs: SessionRevocation[] = [];
    revocations.subscribe((r) => heardByApp.push(r));
    revocations.subscribe((r) => heardByYjs.push(r));
    const revocation = { userId: "u1", keepToken: "raw" };
    revocations.revoke(revocation);
    expect(heardByApp).toEqual([revocation]);
    expect(heardByYjs).toEqual([revocation]);
  });

  it("does not spare a layer because another one threw", () => {
    const revocations = createSessionRevocations();
    const heard: string[] = [];
    revocations.subscribe(() => {
      throw new Error("socket layer broke");
    });
    revocations.subscribe((r) => heard.push(r.userId));
    expect(() => revocations.revoke({ userId: "u1" })).not.toThrow();
    expect(heard).toEqual(["u1"]);
  });

  it("stops telling a listener once it unsubscribes, and leaves the others", () => {
    const revocations = createSessionRevocations();
    const first: string[] = [];
    const second: string[] = [];
    const stop = revocations.subscribe((r) => first.push(r.userId));
    revocations.subscribe((r) => second.push(r.userId));
    revocations.revoke({ userId: "a" });
    stop();
    stop();
    revocations.revoke({ userId: "b" });
    expect(first).toEqual(["a"]);
    expect(second).toEqual(["a", "b"]);
  });

  it("keeps two servers' revocations apart", () => {
    const one = createSessionRevocations();
    const two = createSessionRevocations();
    const heard: string[] = [];
    two.subscribe((r) => heard.push(r.userId));
    one.revoke({ userId: "u1" });
    expect(heard).toEqual([]);
  });
});
