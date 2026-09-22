import { signal } from "@preact/signals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An app resumed from the background comes back to a socket the browser closed
 * while the page was frozen, and to a backoff that the retries it managed in
 * between may have grown to half a minute. Waiting that out leaves the notes
 * list stale, and the banner up, long after the app is on screen, so being
 * shown again is a reason to dial straight away.
 *
 * The socket and the modules around it are faked; what is real is the wiring
 * `startAppSocket` puts on `document` and the guard that keeps a live socket
 * from being replaced. A real DOM is the point here, hence the browser project.
 */
const authToken = signal<string | null>(null);
const editingNoteId = signal<string | null>(null);
const loadNotes = vi.fn(async () => {});

vi.mock("../state/auth.js", () => ({
  authToken,
  clearAuthLocal: () => {
    authToken.value = null;
  },
  isServerMode: true,
  WS_ORIGIN: "ws://notes.invalid",
}));
vi.mock("../state/actions.js", () => ({
  loadNotes,
  notes: signal([]),
  receiveNote: () => {},
}));
vi.mock("../state/presence.js", () => ({
  clearPresence: () => {},
  recordPresenceJoin: () => {},
  recordPresenceLeave: () => {},
}));
vi.mock("../state/sharing.js", () => ({
  forgetInvitation: () => {},
  loadInvitations: async () => {},
  receiveInvitation: () => {},
}));
vi.mock("../state/ui.js", () => ({ editingNoteId }));

const dialled: FakeSocket[] = [];

/** Just enough of a WebSocket for `appSocket` to drive, plus the two things a
 * test needs to do to it: answer, and die the way a frozen page's socket does. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    dialled.push(this);
  }

  send() {}

  close() {
    this.readyState = FakeSocket.CLOSED;
  }

  answer() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  receive(event: unknown) {
    this.onmessage?.({ data: JSON.stringify(event) });
  }

  /** The close the browser hands us for a socket it tore down. */
  die(code = 1006) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

vi.stubGlobal("WebSocket", FakeSocket);

const { connectionStatus, startAppSocket } = await import("./appSocket.js");

startAppSocket();

let tokens = 0;

/** A signed-in session on an open socket, whatever the last test left behind.
 * Each test gets its own token, since a signal ignores a write of what it
 * already holds and it is the change that tears the old socket down. */
function signedIn(): FakeSocket {
  authToken.value = null;
  dialled.length = 0;
  authToken.value = `token-${++tokens}`;
  const socket = dialled[0];
  if (!socket) throw new Error("no socket was dialled");
  socket.answer();
  return socket;
}

function becomeVisible() {
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  // The tests below read `document.visibilityState`, which a test page has no
  // way to set. It is visible; the assertions say so if that ever changes.
  expect(document.visibilityState).toBe("visible");
});

describe("coming back to the foreground", () => {
  it("dials at once instead of waiting the backoff out", () => {
    const socket = signedIn();
    socket.die();
    expect(connectionStatus.value).toBe("closed");
    // The backoff is seconds away, so nothing has been dialled yet.
    expect(dialled).toHaveLength(1);

    becomeVisible();
    expect(dialled).toHaveLength(2);
    expect(connectionStatus.value).toBe("connecting");
  });

  it("leaves a socket that is already up alone", () => {
    signedIn();
    becomeVisible();
    expect(dialled).toHaveLength(1);
    expect(connectionStatus.value).toBe("open");
  });

  it("leaves a socket that is still dialling alone", () => {
    authToken.value = null;
    dialled.length = 0;
    authToken.value = `token-${++tokens}`;
    expect(dialled).toHaveLength(1);

    becomeVisible();
    expect(dialled).toHaveLength(1);
  });

  it("dials nothing for a signed-out session", () => {
    signedIn();
    authToken.value = null;
    dialled.length = 0;

    becomeVisible();
    window.dispatchEvent(new Event("online"));
    expect(dialled).toHaveLength(0);
    expect(connectionStatus.value).toBe("idle");
  });

  it("dials for a socket the browser closed without telling us", () => {
    // A resume can deliver the visibility change before the queued close
    // event. The socket is dead either way, and the close that follows must
    // not be able to pull us back onto the backoff.
    const socket = signedIn();
    socket.readyState = FakeSocket.CLOSED;

    becomeVisible();
    expect(dialled).toHaveLength(2);

    socket.die();
    expect(connectionStatus.value).toBe("connecting");
    expect(dialled).toHaveLength(2);
  });

  it("dials when the browser says it is online again", () => {
    const socket = signedIn();
    socket.die();
    dialled.length = 0;

    window.dispatchEvent(new Event("online"));
    expect(dialled).toHaveLength(1);
  });
});

describe("an outage that outlasts the banner's wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps to the backoff and catches up when it gets back", () => {
    // The banner's outage timer used to re-run the token effect, which dialled
    // again every 4s and forgot the socket had been open, so the reconnect
    // skipped the fetch of what changed meanwhile.
    const socket = signedIn();
    loadNotes.mockClear();
    socket.die();

    vi.advanceTimersByTime(10_000);
    expect(dialled).toHaveLength(2);

    dialled[1]?.answer();
    expect(loadNotes).toHaveBeenCalledTimes(1);
  });
});

describe("a socket that dies without a close", () => {
  // The limit is two and a half heartbeats; past it by a beat is past it.
  const SILENT_FOR = 30_000 * 3.5;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is given up on once the heartbeats stop, and redialled", () => {
    const socket = signedIn();
    socket.receive({ type: "heartbeat" });

    // The browser never reports a close; the silence is what decides.
    vi.advanceTimersByTime(SILENT_FOR);
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
    expect(dialled).toHaveLength(2);
  });

  it("is kept while the heartbeats keep coming", () => {
    const socket = signedIn();
    for (let i = 0; i < 10; i++) {
      socket.receive({ type: "heartbeat" });
      vi.advanceTimersByTime(30_000);
    }
    expect(dialled).toHaveLength(1);
    expect(connectionStatus.value).toBe("open");
  });

  it("is not judged by silence if the server never sends heartbeats", () => {
    // A server from before heartbeats: a quiet board is not a dead socket.
    signedIn();
    vi.advanceTimersByTime(SILENT_FOR * 10);
    expect(dialled).toHaveLength(1);
    expect(connectionStatus.value).toBe("open");
  });

  it("is redialled at once on resume after a freeze no timer saw", () => {
    const socket = signedIn();
    socket.receive({ type: "heartbeat" });
    // A frozen page runs no timers, so only the clock moves.
    vi.setSystemTime(Date.now() + 60 * 60_000);

    becomeVisible();
    expect(dialled).toHaveLength(2);
    expect(connectionStatus.value).toBe("connecting");
  });

  it("leaves the new socket alone while it is still dialling", () => {
    const socket = signedIn();
    socket.receive({ type: "heartbeat" });
    vi.setSystemTime(Date.now() + 60 * 60_000);
    becomeVisible();
    expect(dialled).toHaveLength(2);

    becomeVisible();
    expect(dialled).toHaveLength(2);
  });
});
