import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionOutage,
  OUTAGE_AFTER_MS,
  trackConnection,
} from "./connectionOutage.js";

/**
 * The banner is the one thing that tells someone their notes have stopped
 * travelling, and it used to say so on every resume: an app coming back from
 * the background always finds its socket closed, so "Disconnected" flashed up
 * while the reconnect that takes a moment was already under way. The rule has
 * to sit out the ordinary case and still report an outage that lasts.
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
    // What a resume looks like: the browser closed the socket while the app
    // was frozen, and appSocket dials again straight away.
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
    // "connecting" and "closed" alternate while the backoff retries. They are
    // all one outage, so none of them restarts the wait.
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
    // A logout or open mode: no server is wanted, so there is nothing to wait
    // for and nothing to announce.
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
