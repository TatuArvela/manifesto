import { apiFetch } from "../storage/apiRequest.js";

/**
 * Downloads a zip of every note an account owns, as the server builds it
 * (`GET /api/export`, or an admin's `/api/admin/users/:id/export`): the notes
 * as JSON with their images, and each as Markdown. Resolves false if it could
 * not be fetched, for the caller to say so.
 */
export async function downloadAccountExport(userId?: string): Promise<boolean> {
  const path = userId
    ? `/admin/users/${encodeURIComponent(userId)}/export`
    : "/export";
  const res = await apiFetch("GET", path);
  if (!res?.ok) return false;
  try {
    const name =
      /filename="([^"]+)"/.exec(
        res.headers.get("Content-Disposition") ?? "",
      )?.[1] ?? "notes.zip";
    saveFile(await res.blob(), name);
    return true;
  } catch {
    return false;
  }
}

/** Hands a file to the browser as a download under `name`. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
