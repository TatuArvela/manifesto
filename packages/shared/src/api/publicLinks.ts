/**
 * What a public link shows. `live` follows the note when it changes. `snapshot`
 * keeps the note as it was when the link was made.
 */
export const PUBLIC_LINK_MODES = ["live", "snapshot"] as const;
export type PublicLinkMode = (typeof PUBLIC_LINK_MODES)[number];

/** The maximum view limit of a link. A higher limit has no meaning. */
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
   * The link key, sealed under the personal key of the owner. Thus, the owner
   * can copy the full address again. The server never has the key itself.
   */
  sealedLinkKey: string;
}

/**
 * The copy of the note of a snapshot link: its title, text, font, images and
 * link previews, sealed in the browser of the owner under a key derived from
 * the link key. Also the attachments that those name, by which the server
 * serves them.
 */
export interface PublicSnapshot {
  title: string;
  content: string;
  font: string;
  images: string;
  linkPreviews: string;
  refs: string[];
  /**
   * The format of the words of the copy. A snapshot made before the app
   * recorded formats has none, and is format 1.
   */
  format?: number;
}

export interface PublicLinkCreateRequest {
  mode: PublicLinkMode;
  /** The days from now until it stops. If not given, it does not expire. */
  expiresInDays?: number;
  /** The page asks each viewer for it before it shows the note. */
  password?: string;
  maxViews?: number;
  sealedLinkKey: string;
  /** For a `live` link: the note key, wrapped by the link key. */
  wrappedKey?: string;
  /** For a `snapshot` link: the current note, sealed for the link. */
  snapshot?: PublicSnapshot;
}

export interface PublicLinkResponse {
  link: PublicLink;
}

export interface PublicLinksResponse {
  links: PublicLink[];
}

/**
 * A note as a public link gives it to all persons with the link: its title,
 * text, font, images and link previews, sealed. It contains no data about the
 * writer, its tags, its color or its position among the notes of the owner. The
 * page opens it with the link key from its own address. Its pictures are also
 * sealed. `GET /api/v1/public/:token/attachments/:id` serves them.
 */
export interface PublicNote {
  /** The id of the note, to which its sealed values are bound. */
  id: string;
  /** The key under which they are: that of the note, or 1 for a snapshot. */
  keyVersion: number;
  /** The format of the words: that of the note, or that of the snapshot. */
  format: number;
  title: string;
  content: string;
  font: string;
  images: string;
  linkPreviews: string;
  /** The last change of the text: that of the note, or that of the snapshot. */
  updatedAt: string;
}

export interface PublicNoteResponse {
  note: PublicNote;
  /**
   * For a live link, the note key wrapped by the link key. Null for a snapshot,
   * whose copy is under a key derived from the link key itself.
   */
  wrappedKey: string | null;
  /**
   * For a link with a password, what the attachment requests send as
   * `X-Link-Access`. Thus, the server checks the password one time, not for
   * each image. Null for a link without a password.
   */
  access: string | null;
}

/**
 * `GET /api/v1/public/:token` of a link with a password, before it is given.
 */
export interface PublicNoteLockedResponse {
  passwordRequired: true;
}
