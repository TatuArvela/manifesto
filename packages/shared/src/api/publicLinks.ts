import type { LinkPreview, NoteColor, NoteFont } from "../note.js";

/**
 * What a public link shows: `live` follows the note as it changes, `snapshot`
 * keeps the note as it was when the link was made.
 */
export const PUBLIC_LINK_MODES = ["live", "snapshot"] as const;
export type PublicLinkMode = (typeof PUBLIC_LINK_MODES)[number];

/** Most views a link can be limited to; past it, a limit means nothing. */
export const MAX_PUBLIC_LINK_VIEWS = 10_000;

/** A public link as its owner sees it. The token is the link. */
export interface PublicLink {
  token: string;
  noteId: string;
  mode: PublicLinkMode;
  /** Null for a link that does not expire. */
  expiresAt: string | null;
  hasPassword: boolean;
  /** Null for no limit. */
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  /**
   * Whether whoever holds the link may change the note's title and text, not
   * only read them. A `live` link only. Absent from a server from before
   * links could edit, which is the same as false.
   */
  canEdit?: boolean;
}

export interface PublicLinkCreateRequest {
  mode: PublicLinkMode;
  /** Days from now until it stops working; left out, it does not expire. */
  expiresInDays?: number;
  /** Asked of every viewer before the note is shown. */
  password?: string;
  maxViews?: number;
  /** Lets the link's holder edit the title and text. `live` only, and not
   * together with `maxViews`. */
  canEdit?: boolean;
}

export interface PublicLinkResponse {
  link: PublicLink;
}

export interface PublicLinksResponse {
  links: PublicLink[];
}

/**
 * A note as a public link shows it to anyone holding the link: the text and
 * how it looks, and nothing about who wrote it, its tags or its place among
 * the owner's notes. `images` and link preview pictures are `attachment:`
 * references, served by `GET /api/public/:token/attachments/:id`.
 */
export interface PublicNote {
  title: string;
  content: string;
  color: NoteColor;
  font: NoteFont;
  images: string[];
  linkPreviews: LinkPreview[];
  /** When the text shown last changed: the note's, or the snapshot's. */
  updatedAt: string;
}

export interface PublicNoteResponse {
  note: PublicNote;
  /**
   * For a link with a password, what the attachment requests carry as
   * `X-Link-Access`, so the password is checked once and not per image.
   * Null for a link without one.
   */
  access: string | null;
  /** Whether this link may also change the note; see `PublicLink.canEdit`. */
  canEdit?: boolean;
}

/**
 * `PUT /api/public/:token`, for a link that can edit: the title, the text, or
 * both. Sent with `If-Match` set to the `updatedAt` of the note as it was
 * shown, so an edit made meanwhile is not written over; a `412` carries the
 * note as it now stands.
 */
export interface PublicNoteUpdateRequest {
  title?: string;
  content?: string;
}

/** `GET /api/public/:token` of a link with a password, before it is given. */
export interface PublicNoteLockedResponse {
  passwordRequired: true;
}
