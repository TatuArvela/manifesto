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
   * The link key, sealed under the owner's personal key, so the owner can
   * copy the whole address again. The server never holds the key itself.
   */
  sealedLinkKey: string;
}

/**
 * A snapshot link's copy of the note: its title, text, font, images and link
 * previews, sealed in the owner's browser under a key derived from the link
 * key, and the attachments those name, which the server serves by.
 */
export interface PublicSnapshot {
  title: string;
  content: string;
  font: string;
  images: string;
  linkPreviews: string;
  refs: string[];
}

export interface PublicLinkCreateRequest {
  mode: PublicLinkMode;
  /** Days from now until it stops working; left out, it does not expire. */
  expiresInDays?: number;
  /** Asked of every viewer before the note is shown. */
  password?: string;
  maxViews?: number;
  sealedLinkKey: string;
  /** For a `live` link: the note key, wrapped by the link key. */
  wrappedKey?: string;
  /** For a `snapshot` link: the note as it is now, sealed for the link. */
  snapshot?: PublicSnapshot;
}

export interface PublicLinkResponse {
  link: PublicLink;
}

export interface PublicLinksResponse {
  links: PublicLink[];
}

/**
 * A note as a public link hands it to anyone holding the link: its title,
 * text, font, images and link previews, sealed, and nothing about who wrote
 * it, its tags, its colour or its place among the owner's notes. The page
 * opens it with the link key from its own address. Its pictures are sealed
 * too, served by `GET /api/public/:token/attachments/:id`.
 */
export interface PublicNote {
  /** The note's id, which its sealed values are bound to. */
  id: string;
  /** Which key they are under: the note's, or 1 for a snapshot's own. */
  keyVersion: number;
  title: string;
  content: string;
  font: string;
  images: string;
  linkPreviews: string;
  /** When the text shown last changed: the note's, or the snapshot's. */
  updatedAt: string;
}

export interface PublicNoteResponse {
  note: PublicNote;
  /**
   * For a live link, the note key wrapped by the link key. Null for a
   * snapshot, whose copy is under a key derived from the link key itself.
   */
  wrappedKey: string | null;
  /**
   * For a link with a password, what the attachment requests carry as
   * `X-Link-Access`, so the password is checked once and not per image.
   * Null for a link without one.
   */
  access: string | null;
}

/** `GET /api/public/:token` of a link with a password, before it is given. */
export interface PublicNoteLockedResponse {
  passwordRequired: true;
}
