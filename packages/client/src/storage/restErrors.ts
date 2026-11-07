import type { ErrorResponse, Note } from "@manifesto/shared";

/** The refusals of `RestApiAdapter`, and what it reads out of an error body. */

/** The `code` of an error body, when it has one. */
export async function refusalCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.json()) as Partial<ErrorResponse>).code;
  } catch {
    return undefined;
  }
}

/** The own message of the server from an error body, or `fallback`. */
export function errorMessage(
  data: Partial<ErrorResponse>,
  fallback: string,
): string {
  return typeof data.error === "string" && data.error.length > 0
    ? data.error
    : fallback;
}

/**
 * Thrown when an update collides with a newer version on the server. The caller
 * can use `currentNote` to run a 3-way merge, and try again with a new
 * `If-Match`.
 */
export class NoteConflictError extends Error {
  constructor(public currentNote: Note) {
    super("Note has changed");
    this.name = "NoteConflictError";
  }
}

/** A request that the server answered with a refusal. `status` tells which. */
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

/**
 * An image upload that the server refused (`status`), or that never arrived
 * (0).
 */
export class ImageUploadError extends Error {
  constructor(readonly status: number) {
    super(`Image upload failed (${status})`);
    this.name = "ImageUploadError";
  }
}
