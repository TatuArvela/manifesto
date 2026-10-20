import { signal } from "@preact/signals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An app that resumes from the background comes back to a socket that the
 * browser closed while the page was frozen, and to a backoff that its retries
 * in the meantime possibly made as long as half a minute. A wait for it leaves
 * the notes list stale, and the banner open, long after the app is on the
 * screen. Thus, when the app shows again, it connects immediately.
 *
 * The socket and the modules around it are fakes. The real parts are the
 * connections that `startAppSocket` puts on `document`, and the guard that
 * prevents the replacement of a live socket. A real DOM is the purpose here.
 * Thus, this is in the browser project.
 */
const authToken = signal<string | null>(null);
const editingNoteId = signal<string | null>(null);
const notes = signal<unknown[]>([]);
const syncNotes = vi.fn(async () => {});

vi.mock("#/state/account/auth.ts", () => ({
  authToken,
  clearAuthLocal: () => {
    authToken.value = null;
  },
  isServerMode: true,
  WS_ORIGIN: "ws://notes.invalid",
}));
vi.mock("#/state/comments.ts", () => ({
  forgetComment: () => {},
  receiveComment: () => {},
  reloadComments: () => {},
}));
vi.mock("#/state/notesStore.ts", () => ({
  forgetNote: () => {},
  notes,
  syncNotes,
  receiveNote: () => {},
}));
vi.mock("#/state/presence.ts", () => ({
  clearPresence: () => {},
  recordPresenceJoin: () => {},
  recordPresenceLeave: () => {},
}));
vi.mock("#/state/sharing.ts", () => ({
  forgetInvitation: () => {},
  loadInvitations: async () => {},
  receiveInvitation: () => {},
}));
vi.mock("#/state/ui.ts", () => ({ editingNoteId }));
vi.mock("#/state/unsentNotes.ts", () => ({ sendUnsent: async () => {} }));

const dialled: FakeSocket[] = [];

/**
 * Only sufficient parts of a WebSocket for `appSocket` to control, and the two
 * things that a test must do to it: answer, and die as the socket of a frozen
 * page does.
 */
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

  /** The close that the browser gives us for a socket that it closed. */
  die(code = 1006) {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }
}

vi.stubGlobal("WebSocket", FakeSocket);

const { connectionStatus, startAppSocket } = await import("./appSocket.ts");

startAppSocket();

let tokens = 0;

/**
 * A signed-in session on an open socket, whatever the last test left. Each test
 * gets its own token, because a signal ignores a write of the value that it
 * already has, and the change closes the old socket.
 */
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
  // The tests below read `document.visibilityState`, which a test page cannot
  // set. It is visible. The assertions show if that ever changes.
  expect(document.visibilityState).toBe("visible");
});

describe("coming back to the foreground", () => {
  it("dials at once instead of waiting the backoff out", () => {
    const socket = signedIn();
    socket.die();
    expect(connectionStatus.value).toBe("closed");
    // The backoff is seconds away. Thus, nothing connected yet.
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
    // A resume can deliver the visibility change before the queued close event.
    // The socket is dead in both cases, and the close that follows must not be
    // able to put us back on the backoff.
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
    // Before, the outage timer of the banner ran the token effect again. It
    // connected again each 4s, and forgot that the socket had been open. Thus,
    // the reconnect skipped the fetch of what changed in the meantime.
    const socket = signedIn();
    syncNotes.mockClear();
    socket.die();

    vi.advanceTimersByTime(10_000);
    expect(dialled).toHaveLength(2);

    dialled[1]?.answer();
    expect(syncNotes).toHaveBeenCalledTimes(1);
  });
});

describe("a socket that dies without a close", () => {
  // The limit is two and a half heartbeats. One beat past it is past it.
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

    // The browser never reports a close. The silence decides.
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
    // A frozen page runs no timers. Thus, only the clock moves.
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
