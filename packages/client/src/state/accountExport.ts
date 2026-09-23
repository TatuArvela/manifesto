import { storageConnection } from "../storage/index.js";

/**
 * Downloads a zip of every note an account owns, as the server builds it
 * (`GET /api/export`, or an admin's `/api/admin/users/:id/export`): the notes
 * as JSON with their images, and each as Markdown. Resolves false if it could
 * not be fetched, for the caller to say so.
 */
export async function downloadAccountExport(userId?: string): Promise<boolean> {
  const { serverUrl, token, onUnauthorized } = storageConnection.value;
  if (serverUrl === null || !token) return false;
  const path = userId
    ? `/api/admin/users/${encodeURIComponent(userId)}/export`
    : "/api/export";
  try {
    const res = await fetch(`${serverUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) onUnauthorized?.();
    if (!res.ok) return false;
    const name =
      /filename="([^"]+)"/.exec(
        res.headers.get("Content-Disposition") ?? "",
      )?.[1] ?? "notes.zip";
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
