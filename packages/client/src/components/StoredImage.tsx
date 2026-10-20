import { isStoredImageRef } from "@manifesto/shared";
import type { PartialImgHTMLAttributes } from "preact";
import { useEffect, useState } from "preact/hooks";
import { attachmentObjectUrl } from "#/state/attachments.ts";

/**
 * An `<img>` for one of the images of a note, or of a link preview, in either
 * of its forms: inline as a `data:` URL, or as a reference to the attachment
 * store of the server, which the code first gets with the credentials of the
 * session. Until then, it is an empty box of the same shape. Thus, a card does
 * not jump.
 */
export function StoredImage({
  src,
  alt,
  placeholderClass = "block min-h-24",
  ...rest
}: {
  src: string;
  alt: string;
  /**
   * The own classes of the empty box, in addition to those of the image. The
   * default is correct for a gallery image, not for a small icon.
   */
  placeholderClass?: string;
} & Omit<
  PartialImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt" | "role" | "title" | "aria-label" | "aria-labelledby"
>) {
  const [resolved, setResolved] = useState<string | null>(() =>
    isStoredImageRef(src) ? null : src,
  );

  useEffect(() => {
    if (!isStoredImageRef(src)) {
      setResolved(src);
      return;
    }
    let live = true;
    setResolved(null);
    void attachmentObjectUrl(src).then((url) => {
      if (live) setResolved(url);
    });
    return () => {
      live = false;
    };
  }, [src]);

  if (resolved === null) {
    return (
      <span
        aria-hidden="true"
        class={`${placeholderClass} ${rest.class ?? ""}`}
      />
    );
  }
  return <img src={resolved} alt={alt} {...rest} />;
}
