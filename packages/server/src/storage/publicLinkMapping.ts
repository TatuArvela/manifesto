import type { PublicLinkMode, PublicNote } from "@manifesto/shared";
import { referencesOf } from "./attachmentMapping.js";
import type { StoredPublicLink } from "./types.js";

/** A `public_links` row as both drivers read it. */
export interface PublicLinkRow {
  token: string;
  note_id: string;
  owner_id: string;
  mode: string;
  snapshot: string | null;
  password_hash: string | null;
  expires_at: string | null;
  max_views: number | null;
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
}

export const PUBLIC_LINK_COLUMNS = `token, note_id, owner_id, mode, snapshot,
  password_hash, expires_at, max_views, view_count, last_viewed_at, created_at`;

export function rowToPublicLink(row: PublicLinkRow): StoredPublicLink {
  return {
    token: row.token,
    noteId: row.note_id,
    ownerId: row.owner_id,
    mode: row.mode as PublicLinkMode,
    snapshot: row.snapshot ? (JSON.parse(row.snapshot) as PublicNote) : null,
    passwordHash: row.password_hash,
    hasPassword: row.password_hash !== null,
    expiresAt: row.expires_at,
    maxViews: row.max_views === null ? null : Number(row.max_views),
    viewCount: Number(row.view_count),
    lastViewedAt: row.last_viewed_at,
    createdAt: row.created_at,
  };
}

/**
 * The links that still hold on to their snapshot's attachments: those that can
 * still be viewed. `now` is the placeholder for the sweep's time.
 */
export function usableSnapshotsWhere(now: string): string {
  return `mode = 'snapshot'
    AND (expires_at IS NULL OR expires_at > ${now})
    AND (max_views IS NULL OR view_count < max_views)`;
}

/** The attachment ids a snapshot shows, for the attachment sweep. */
export function snapshotReferences(snapshot: string | null): string[] {
  if (!snapshot) return [];
  const note = JSON.parse(snapshot) as PublicNote;
  return referencesOf({
    images: JSON.stringify(note.images),
    link_previews: JSON.stringify(note.linkPreviews),
  });
}
