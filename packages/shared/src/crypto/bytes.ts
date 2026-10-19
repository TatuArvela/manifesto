// Changes bytes to text and back, with only what a browser and Node both have.

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

/**
 * Null for bytes that are not UTF-8. Only a wrong key or a faulty writer makes
 * such bytes.
 */
export function fromUtf8(bytes: Uint8Array): string | null {
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export function bytesToBase64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  // In parts, because one `fromCharCode` call accepts a limited number of
  // arguments.
  for (let at = 0; at < view.length; at += 0x8000) {
    binary += String.fromCharCode(...view.subarray(at, at + 0x8000));
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/={1,2}$/, "");
}

/** Throws on all input that is not base64url. */
export function base64urlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Overwrites key bytes after their use. */
export function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}
