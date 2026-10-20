import {
  type AccountSealKeys,
  currentNoteFormat,
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
 * What seals a public link, separate from the `Sealer` that has the keys that
 * it needs (`Sealer.publish` and `Sealer.openLinkKey` give them). Kept out of
 * `sealing.ts`, which imports this, and never the opposite.
 */

/** What `publish` gets: the link key and the fields of the request. */
export interface SealedPublicLink {
  linkKey: string;
  fields: Pick<
    PublicLinkCreateRequest,
    "sealedLinkKey" | "wrappedKey" | "snapshot"
  >;
}

/**
 * What the publication of a note needs: a new link key, which goes into the
 * address of the link and to no other place, and what the server gets. A live
 * link gets the note key wrapped by the link key. A snapshot gets a copy of the
 * note as it is now, sealed under a key derived from the link key. In both
 * cases, the link key is also sealed for this account. Thus, its owner can copy
 * the address again.
 *
 * Only a live link asks for `noteKey`, and its bytes are wiped here after the
 * wrap.
 */
export async function sealPublicLink(
  account: AccountSealKeys,
  note: Pick<
    Note,
    | "id"
    | "title"
    | "content"
    | "font"
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
        format: currentNoteFormat(),
      },
    },
  };
}

/**
 * The key of a link, from the copy sealed for its owner. Null when it does not
 * open.
 */
export async function openPublicLinkKey(
  account: AccountSealKeys,
  noteId: string,
  sealed: string,
): Promise<string | null> {
  const opened = await openPref(account, `link/${noteId}`, sealed);
  return typeof opened === "string" ? opened : null;
}
