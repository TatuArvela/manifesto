import type {
  AuthMeResponse,
  CapabilitiesResponse,
  ErrorResponse,
  Note,
  NoteCreate,
  NoteResponse,
  NotesResponse,
  NoteUpdate,
  PageParams,
} from "@manifesto/shared";

/**
 * A small client for a Manifesto server's REST API, for scripts and bots.
 *
 *   const api = createClient({ url: "https://notes.example", token: "mfp_..." });
 *   const note = await api.notes.create({ title: "Hello", content: "From a script" });
 *   for await (const each of api.notes.all()) console.log(each.title);
 *
 * It covers what a personal API token reaches (Settings > API tokens): notes,
 * search, images and the account it belongs to. It has no dependencies and
 * uses the platform's `fetch`, so it runs in Node, Deno, Bun and a browser.
 * The types are the server's own, from `@manifesto/shared`.
 *
 * It is a thin layer on purpose. Every method is one request (the iterators,
 * one request a page), nothing is cached, and a refusal is thrown as a
 * `ManifestoApiError` carrying the status the server gave.
 */

export type {
  AuthMeResponse,
  CapabilitiesResponse,
  Note,
  NoteCreate,
  NotesResponse,
  NoteUpdate,
  PageParams,
} from "@manifesto/shared";

export interface ClientOptions {
  /** Where the server is: its origin, with any path it is served under, and
   * without `/api`. */
  url: string;
  /** A personal API token (`mfp_...`), or a session token. */
  token: string;
  /** In place of the platform's `fetch`: a proxy, a retry wrapper, a test. */
  fetch?: typeof fetch;
}

/** A request the server refused, or that never reached it (`status` 0). */
export class ManifestoApiError extends Error {
  readonly status: number;
  /** The server's machine-readable code, where it gives one. */
  readonly code: ErrorResponse["code"];
  /**
   * On a 412 from `notes.update`: the note as the server holds it now, to
   * merge with and try again.
   */
  readonly current: Note | undefined;
  /** On a 429: how many seconds the server asks the caller to wait. */
  readonly retryAfter: number | undefined;

  constructor(
    status: number,
    message: string,
    details: {
      code?: ErrorResponse["code"];
      current?: Note | undefined;
      retryAfter?: number | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, details.cause === undefined ? {} : { cause: details.cause });
    this.name = "ManifestoApiError";
    this.status = status;
    this.code = details.code;
    this.current = details.current;
    this.retryAfter = details.retryAfter;
  }
}

/**
 * What a new note needs from the caller: its text. Everything else takes the
 * value a note made in the app would have.
 */
export type NewNote = Partial<Omit<NoteCreate, "trashed" | "trashedAt">> &
  Pick<NoteCreate, "content">;

/** `position` aside, which is given at the time of the call. */
const NOTE_DEFAULTS = {
  title: "",
  color: "default",
  font: "default",
  pinned: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  tags: [],
  images: [],
  linkPreviews: [],
  reminder: null,
} as const;

export interface UpdateOptions {
  /**
   * The `updatedAt` of the copy the changes were made to. With it the server
   * refuses the write (412, with the current note on the error) if the note
   * has changed since; without it the write lands regardless.
   */
  ifMatch?: string;
}

export type Client = ReturnType<typeof createClient>;

export function createClient(options: ClientOptions) {
  // Trailing slashes off by hand: a pattern for them is slow on a long run.
  let origin = options.url;
  while (origin.endsWith("/")) origin = origin.slice(0, -1);
  const base = `${origin}/api`;
  const send = options.fetch ?? fetch;

  async function request(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    let res: Response;
    try {
      res = await send(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${options.token}`,
          ...(init.body !== undefined && {
            "Content-Type": "application/json",
          }),
          ...init.headers,
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      });
    } catch (cause) {
      throw new ManifestoApiError(
        0,
        `The server at ${options.url} could not be reached`,
        { cause },
      );
    }
    if (res.ok) return res;

    let body: Partial<ErrorResponse & NoteResponse> = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      // Not JSON; the status says what there is to say.
    }
    // Read before converting: an absent header would otherwise count as 0.
    const waitHeader = res.headers.get("Retry-After");
    const retryAfter = waitHeader === null ? Number.NaN : Number(waitHeader);
    throw new ManifestoApiError(
      res.status,
      body.error ?? `${method} ${path} answered ${res.status}`,
      {
        code: body.code,
        current: res.status === 412 ? body.note : undefined,
        retryAfter:
          res.status === 429 && Number.isFinite(retryAfter)
            ? retryAfter
            : undefined,
      },
    );
  }

  async function json<T>(
    method: string,
    path: string,
    init?: Parameters<typeof request>[2],
  ): Promise<T> {
    return (await (await request(method, path, init)).json()) as T;
  }

  function pageQuery(page: PageParams, extra: Record<string, string> = {}) {
    const query = new URLSearchParams(extra);
    if (page.limit !== undefined) query.set("limit", String(page.limit));
    if (page.cursor !== undefined) query.set("cursor", page.cursor);
    const text = query.toString();
    return text ? `?${text}` : "";
  }

  /** Every note of a paged listing, one page fetched as the last runs out. */
  async function* every(
    fetchPage: (page: PageParams) => Promise<NotesResponse>,
    limit: number | undefined,
  ): AsyncGenerator<Note, void, void> {
    let cursor: string | undefined;
    do {
      const page = await fetchPage({
        ...(limit !== undefined && { limit }),
        ...(cursor !== undefined && { cursor }),
      });
      yield* page.notes;
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }

  const notes = {
    /**
     * One page of the notes the token's account can see, its own and those
     * shared with it, most recently changed first. Listed notes carry no
     * images; `get` brings those.
     */
    list(page: PageParams = {}): Promise<NotesResponse> {
      return json("GET", `/notes${pageQuery(page)}`);
    },

    /** Every note, across pages. `limit` is the page size, not a total. */
    all(options: { limit?: number } = {}) {
      return every((page) => notes.list(page), options.limit);
    },

    async get(id: string): Promise<Note> {
      const body = await json<NoteResponse>(
        "GET",
        `/notes/${encodeURIComponent(id)}`,
      );
      return body.note;
    },

    /**
     * A new note, newest first among those made by the clock unless
     * `position` says otherwise. The app also steps ahead of a note pinned or
     * dragged to the head, which takes the whole board; to do the same, pass a
     * `position` lower than every note's.
     */
    async create(note: NewNote): Promise<Note> {
      const body = await json<NoteResponse>("POST", "/notes", {
        body: { ...NOTE_DEFAULTS, position: -Date.now(), ...note },
      });
      return body.note;
    },

    /** Changes the fields given and leaves the rest. See `UpdateOptions`. */
    async update(
      id: string,
      changes: NoteUpdate,
      options: UpdateOptions = {},
    ): Promise<Note> {
      const body = await json<NoteResponse>(
        "PUT",
        `/notes/${encodeURIComponent(id)}`,
        {
          body: changes,
          ...(options.ifMatch !== undefined && {
            headers: { "If-Match": options.ifMatch },
          }),
        },
      );
      return body.note;
    },

    /** Moves the note to the trash, from where it can be restored. */
    trash(id: string): Promise<Note> {
      return notes.update(id, { trashed: true });
    },

    restore(id: string): Promise<Note> {
      return notes.update(id, { trashed: false });
    },

    /** Deletes the note for good. For a note shared with the account, leaves
     * it instead. */
    async delete(id: string): Promise<void> {
      await request("DELETE", `/notes/${encodeURIComponent(id)}`);
    },

    /** One page of the notes whose title or text holds every word of `query`. */
    search(query: string, page: PageParams = {}): Promise<NotesResponse> {
      return json("GET", `/search${pageQuery(page, { q: query })}`);
    },

    /** Every match of a search, across pages. */
    searchAll(query: string, options: { limit?: number } = {}) {
      return every((page) => notes.search(query, page), options.limit);
    },
  };

  return {
    notes,

    /** The account the token belongs to. Needs the `account:read` scope,
     * which a token is not given unless asked for. */
    me(): Promise<AuthMeResponse> {
      return json("GET", "/auth/me");
    },

    /** What the server is and offers: its version, features and limits. */
    capabilities(): Promise<CapabilitiesResponse> {
      return json("GET", "/capabilities");
    },

    images: {
      /**
       * The bytes of an image a note names as `attachment:<id>`, with its
       * media type. Takes the reference or the bare id.
       */
      async get(reference: string): Promise<Blob> {
        const id = reference.replace(/^attachment:/, "");
        const res = await request(
          "GET",
          `/attachments/${encodeURIComponent(id)}`,
        );
        return res.blob();
      },
    },
  };
}
