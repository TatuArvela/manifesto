import type { NoteColor, NoteFont } from "@manifesto/shared";
import { useCallback, useState } from "preact/hooks";
import type { ComposerDraft } from "#/state/composerDraft.ts";
import { placedImageAlts, placeImages } from "#/utils/drawing.ts";
import {
  type DraftLinkPreviews,
  useDraftLinkPreviews,
} from "./useDraftLinkPreviews.ts";

/**
 * The contents of the composer other than its link previews, which load later.
 */
export type ComposerFields = Omit<ComposerDraft, "linkPreviews">;

type FieldsChange =
  | Partial<ComposerFields>
  | ((fields: ComposerFields) => Partial<ComposerFields>);

/** The note that you write in the new-note composer, before it is a note. */
export interface ComposerNote {
  fields: ComposerFields;
  linkPreviews: DraftLinkPreviews;
  /** Changes some fields. A change that changes nothing renders nothing. */
  update(change: FieldsChange): void;
  /** All of it, with the link previews, as a draft is kept. */
  draft(): ComposerDraft;
  /** Empties the composer for the next note, in `color` and `font`. */
  reset(color: NoteColor, font: NoteFont): void;
  /** Puts a kept draft in. */
  fill(draft: ComposerDraft): void;
  addImages(urls: string[], replaces?: string): void;
  removeImage(index: number): void;
  describeImage(image: string, alt: string): void;
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

function emptyFields(color: NoteColor, font: NoteFont): ComposerFields {
  return {
    title: "",
    content: "",
    color,
    font,
    pinned: false,
    tags: [],
    images: [],
    imageAlts: [],
  };
}

function changes(fields: ComposerFields, change: Partial<ComposerFields>) {
  return Object.entries(change).some(
    ([key, value]) => fields[key as keyof ComposerFields] !== value,
  );
}

export function useComposerFields(
  color: () => NoteColor,
  font: () => NoteFont,
): ComposerNote {
  const [fields, setFields] = useState(() => emptyFields(color(), font()));
  const linkPreviews = useDraftLinkPreviews();

  // Stable. Thus, an effect that changes a field does not have to run again for
  // it.
  const update = useCallback(
    (change: FieldsChange) =>
      setFields((current) => {
        const next = typeof change === "function" ? change(current) : change;
        return changes(current, next) ? { ...current, ...next } : current;
      }),
    [],
  );

  return {
    fields,
    linkPreviews,
    update,
    draft: () => ({ ...fields, linkPreviews: linkPreviews.previews }),
    reset: (nextColor, nextFont) => {
      setFields(emptyFields(nextColor, nextFont));
      linkPreviews.clear();
    },
    fill: ({ linkPreviews: previews, ...kept }) => {
      setFields(kept);
      linkPreviews.restore(previews);
    },
    addImages: (urls, replaces) =>
      update((current) => {
        const placed = placeImages(current.images, urls, replaces);
        return {
          images: placed,
          imageAlts: placedImageAlts(current, placed, urls, replaces),
        };
      }),
    removeImage: (index) =>
      update((current) => ({
        images: current.images.filter((_, i) => i !== index),
        imageAlts: current.imageAlts.filter((_, i) => i !== index),
      })),
    describeImage: (image, alt) =>
      update((current) => {
        const index = current.images.indexOf(image);
        if (index === -1) return {};
        const alts = current.images.map((_, i) =>
          i === index ? alt : (current.imageAlts[i] ?? ""),
        );
        return { imageAlts: alts.some((a) => a !== "") ? alts : [] };
      }),
    addTag: (tag) =>
      update((current) =>
        current.tags.includes(tag) ? {} : { tags: [...current.tags, tag] },
      ),
    removeTag: (tag) =>
      update((current) => ({ tags: current.tags.filter((t) => t !== tag) })),
  };
}
