import {
  type Note,
  NoteColor,
  NoteFont,
  type NoteUpdate,
} from "@manifesto/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storageConnection } from "../storage/index.js";
import { forgetNote, notes, receiveNote, updateNote } from "./notesStore.js";
import { type Random, SEEDS, seeded } from "./testRandom.js";

/**
 * Clicks on one note, sent while earlier ones are still in the air, against a
 * server that keeps `If-Match`. Every request, reply and broadcast is held and
 * delivered in an order the seed picks: requests reach the server in any
 * order, replies come back in any order, and broadcasts come in the order the
 * server sent them, since they share one socket. The real `updateNote`,
 * `receiveNote`, `pendingWrites` and `mergeNoteUpdate` run in between.
 *
 * Two properties:
 * - while a click's write is outstanding, the board shows what was clicked,
 *   whatever arrives meanwhile;
 * - once everything has arrived, the board shows what the server has.
 */

const SERVER = "https://notes.example.com";
const ID = "n1";
const CLICKS = 5;
const COLORS = [NoteColor.Default, NoteColor.Blue, NoteColor.Green];
const TAGS = ["a", "b", "c"];

function makeNote(): Note {
  return {
    id: ID,
    title: "",
    content: "",
    color: NoteColor.Default,
    font: NoteFont.Default,
    pinned: false,
    archived: false,
    trashed: false,
    trashedAt: null,
    position: 0,
    tags: [],
    images: [],
    linkPreviews: [],
    reminder: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

type Field = "pinned" | "color" | "tags";
const FIELDS: Field[] = ["pinned", "color", "tags"];
const view = (note: Note | undefined) =>
  note && { pinned: note.pinned, color: note.color, tags: [...note.tags] };

/** A click, made on the note as the board shows it now. */
function click(random: Random, shown: Note): NoteUpdate {
  switch (random.pick(FIELDS)) {
    case "pinned":
      return { pinned: !shown.pinned };
    case "color":
      return { color: random.pick(COLORS) };
    case "tags": {
      const tag = random.pick(TAGS);
      return {
        tags: shown.tags.includes(tag)
          ? shown.tags.filter((t) => t !== tag)
          : [...shown.tags, tag],
      };
    }
  }
}

interface Request {
  changes: NoteUpdate;
  ifMatch: string | null;
  answer: (res: Response) => void;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Lets every promise chain that can move, move: a reply's `res.json()` and the
 * store's handling of it. A task per turn rather than `setTimeout`, which the
 * browser clamps to 4ms once nested and made a few thousand steps slow.
 */
const channel = new MessageChannel();
function nextTask(): Promise<void> {
  return new Promise((resolve) => {
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await nextTask();
}

async function run(seed: number): Promise<void> {
  const random = seeded(seed);
  let server = makeNote();
  let stamp = 0;
  const requests: Request[] = [];
  const replies: Array<() => void> = [];
  const broadcasts: Note[] = [];
  const trace: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      return new Promise<Response>((answer) => {
        requests.push({
          changes: JSON.parse(String(init?.body)) as NoteUpdate,
          ifMatch: headers["If-Match"] ?? null,
          answer,
        });
      });
    }),
  );

  const serve = (request: Request) => {
    if (request.ifMatch !== null && request.ifMatch !== server.updatedAt) {
      const current = structuredClone(server);
      trace.push(`server 412 ${JSON.stringify(request.changes)}`);
      replies.push(() => request.answer(json({ note: current }, 412)));
      return;
    }
    stamp += 1;
    server = {
      ...server,
      ...request.changes,
      updatedAt: new Date(Date.UTC(2026, 0, 2, 0, 0, stamp)).toISOString(),
    };
    const reply = structuredClone(server);
    trace.push(`server applies ${JSON.stringify(request.changes)}`);
    replies.push(() => request.answer(json({ note: reply })));
    broadcasts.push(structuredClone(server));
  };

  /** The newest click touching each field, and whether it is still out. */
  const newest = new Map<Field, { value: unknown; done: boolean }>();
  const shown = () => notes.value.find((n) => n.id === ID) as Note;
  const fail = (what: string) =>
    `seed ${seed}: ${what}\n${trace.join("\n")}\nshown ${JSON.stringify(view(shown()))}\nserver ${JSON.stringify(view(server))}`;

  let clicks = 0;
  let finished = 0;
  for (;;) {
    const moves: Array<() => void> = [];
    if (clicks < CLICKS) {
      moves.push(() => {
        clicks += 1;
        const changes = click(random, shown());
        trace.push(`click ${JSON.stringify(changes)}`);
        const entries = Object.entries(changes).map(
          ([field, value]): [Field, { value: unknown; done: boolean }] => [
            field as Field,
            { value, done: false },
          ],
        );
        for (const [field, entry] of entries) newest.set(field, entry);
        void updateNote(ID, changes).then(() => {
          finished += 1;
          for (const [, entry] of entries) entry.done = true;
        });
      });
    }
    if (requests.length > 0) {
      moves.push(() => {
        const [request] = requests.splice(random.int(requests.length), 1);
        if (request) serve(request);
      });
    }
    if (replies.length > 0) {
      moves.push(() => {
        const [reply] = replies.splice(random.int(replies.length), 1);
        trace.push("reply arrives");
        reply?.();
      });
    }
    if (broadcasts.length > 0) {
      moves.push(() => {
        const note = broadcasts.shift() as Note;
        trace.push(`broadcast ${JSON.stringify(view(note))}`);
        receiveNote(note);
      });
    }
    if (moves.length === 0) break;
    random.pick(moves)();
    await settle();

    for (const [field, entry] of newest) {
      if (entry.done) continue;
      expect(shown()[field], fail(`a pending ${field} was undone`)).toEqual(
        entry.value,
      );
    }
  }

  expect(finished, fail("a write never finished")).toBe(CLICKS);
  expect(view(shown()), fail("the board and the server disagree")).toEqual(
    view(server),
  );
}

describe("pending writes, over generated interleavings", () => {
  beforeEach(() => {
    storageConnection.value = { serverUrl: SERVER, token: "tok" };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    storageConnection.value = { serverUrl: null, token: null };
    notes.value = [];
  });

  it("never undoes a pending click, and ends where the server is", async () => {
    for (const seed of SEEDS) {
      // The store remembers the last copy it confirmed, which would be newer
      // than this run's first.
      forgetNote(ID);
      receiveNote(makeNote());
      await run(seed);
    }
  }, 60_000);
});
