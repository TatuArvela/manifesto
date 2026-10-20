import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionOutage,
  OUTAGE_AFTER_MS,
  trackConnection,
} from "./connectionOutage.ts";

/**
 * The banner is the only thing that tells a person that their notes stopped to
 * go across. Before, it said so on each resume. An app that comes back from the
 * background always finds its socket closed. Thus, "Disconnected" showed for a
 * moment while the reconnect, which takes a short time, was already in
 * progress. The rule must ignore the usual case, and still report an outage
 * that lasts.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  trackConnection("idle");
});

describe("trackConnection", () => {
  it("says nothing while an ordinary reconnect happens", () => {
    // This is a resume: the browser closed the socket while the app was frozen,
    // and appSocket connects again immediately.
    trackConnection("open");
    trackConnection("closed");
    vi.advanceTimersByTime(1200);
    trackConnection("connecting");
    vi.advanceTimersByTime(600);
    trackConnection("open");

    vi.advanceTimersByTime(10 * OUTAGE_AFTER_MS);
    expect(connectionOutage.value).toBe(false);
  });

  it("reports an outage that outlasts the wait", () => {
    trackConnection("closed");
    vi.advanceTimersByTime(OUTAGE_AFTER_MS - 1);
    expect(connectionOutage.value).toBe(false);

    vi.advanceTimersByTime(1);
    expect(connectionOutage.value).toBe(true);
  });

  it("keeps counting across the backoff's retries", () => {
    // "connecting" and "closed" alternate while the backoff tries again. They
    // are all one outage. Thus, none of them starts the wait again.
    trackConnection("closed");
    vi.advanceTimersByTime(OUTAGE_AFTER_MS - 500);
    trackConnection("connecting");
    vi.advanceTimersByTime(300);
    trackConnection("closed");
    vi.advanceTimersByTime(300);
    expect(connectionOutage.value).toBe(true);
  });

  it("clears as soon as the socket is back", () => {
    trackConnection("closed");
    vi.advanceTimersByTime(OUTAGE_AFTER_MS);
    expect(connectionOutage.value).toBe(true);

    trackConnection("open");
    expect(connectionOutage.value).toBe(false);
  });

  it("does not report a socket nobody asked for", () => {
    // A logout or open mode: no server is wanted. Thus, there is nothing to
    // wait for, and nothing to announce.
    trackConnection("idle");
    vi.advanceTimersByTime(10 * OUTAGE_AFTER_MS);
    expect(connectionOutage.value).toBe(false);
  });

  it("starts a fresh wait for the next outage", () => {
    trackConnection("closed");
    vi.advanceTimersByTime(OUTAGE_AFTER_MS);
    trackConnection("open");

    trackConnection("closed");
    vi.advanceTimersByTime(OUTAGE_AFTER_MS - 1);
    expect(connectionOutage.value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(connectionOutage.value).toBe(true);
  });
});
