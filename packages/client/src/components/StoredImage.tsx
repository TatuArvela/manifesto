import { isStoredImageRef } from "@manifesto/shared";
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { attachmentObjectUrl } from "../state/attachments.js";

/**
 * An `<img>` for one of a note's images, whichever way it is held: inline as
 * a `data:` URL, or as a reference to the server's attachment store, which is
 * fetched with the session's credentials first. Until then it is an empty box
 * of the same shape, so a card does not jump.
 */
export function StoredImage({
  src,
  alt,
  ...rest
}: { src: string; alt: string } & Omit<
  JSX.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "alt"
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
      <span aria-hidden="true" class={`block min-h-24 ${rest.class ?? ""}`} />
    );
  }
  return <img src={resolved} alt={alt} {...rest} />;
}
