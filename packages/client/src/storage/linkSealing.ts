import {
  type AccountSealKeys,
  type ImageKeys,
  type Note,
  newLinkKey,
  openPref,
  type PublicLinkCreateRequest,
  type PublicLinkMode,
  sealPref,
  sealSharedFields,
  snapshotKey,
  wipe,
  wrapForLink,
} from "@manifesto/shared";

/**
 * What a public link is sealed with, apart from the `Sealer` that holds the
 * keys it needs (`Sealer.publish` and `Sealer.openLinkKey` hand them in).
 * Kept out of `sealing.ts`, which imports this and never the other way.
 */

/** What `publish` is sent: the link key and the fields of the request. */
export interface SealedPublicLink {
  linkKey: string;
  fields: Pick<
    PublicLinkCreateRequest,
    "sealedLinkKey" | "wrappedKey" | "snapshot"
  >;
}

/**
 * What publishing a note takes: a new link key, which goes into the link's
 * address and nowhere else, and what the server is sent. A live link gets
 * the note key wrapped by the link key; a snapshot gets a copy of the note
 * as it is now, sealed under a key derived from the link key. Either way
 * the link key is also sealed for this account, so its owner can copy the
 * address again.
 *
 * `noteKey` is asked for only by a live link, and its bytes are wiped here
 * once wrapped.
 */
export async function sealPublicLink(
  account: AccountSealKeys,
  note: Pick<
    Note,
    | "id"
    | "title"
    | "content"
    | "font"
    | "ink"
    | "images"
    | "imageAlts"
    | "linkPreviews"
  >,
  mode: PublicLinkMode,
  noteKey: () => Promise<{ version: number; raw: Uint8Array<ArrayBuffer> }>,
  imageKeys: ImageKeys,
): Promise<SealedPublicLink | null> {
  const linkKey = newLinkKey();
  const sealedLinkKey = await sealPref(account, `link/${note.id}`, linkKey);
  if (mode === "live") {
    const { version, raw } = await noteKey();
    try {
      return {
        linkKey,
        fields: {
          sealedLinkKey,
          wrappedKey: await wrapForLink(linkKey, note.id, version, raw),
        },
      };
    } finally {
      wipe(raw);
    }
  }
  const key = await snapshotKey(linkKey);
  if (!key) return null;
  const sealed = await sealSharedFields(
    key,
    note.id,
    {
      title: note.title,
      content: note.content,
      font: note.font,
      ...(note.ink !== undefined && { ink: note.ink }),
      images: note.images,
      ...(note.imageAlts !== undefined && { imageAlts: note.imageAlts }),
      linkPreviews: note.linkPreviews,
    },
    imageKeys,
  );
  return {
    linkKey,
    fields: {
      sealedLinkKey,
      snapshot: {
        title: sealed.title ?? "",
        content: sealed.content ?? "",
        font: sealed.font ?? "",
        images: sealed.images ?? "",
        linkPreviews: sealed.linkPreviews ?? "",
        refs: [...(sealed.imageRefs ?? []), ...(sealed.previewRefs ?? [])],
      },
    },
  };
}

/** A link's key, from the copy sealed for its owner; null when it does
 * not open. */
export async function openPublicLinkKey(
  account: AccountSealKeys,
  noteId: string,
  sealed: string,
): Promise<string | null> {
  const opened = await openPref(account, `link/${noteId}`, sealed);
  return typeof opened === "string" ? opened : null;
}
