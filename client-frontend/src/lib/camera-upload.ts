export type UploadSession = { uploadId: string; chunkBytes: number };
type Fetcher = typeof fetch;
export class CameraRequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export async function cameraRequest(path: string, token: string, init: RequestInit = {}, request: Fetcher = fetch) {
  const response = await request(`/api/camera${path}`, { ...init, headers: { "x-upload-token": token, ...init.headers } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new CameraRequestError(body?.error?.message ?? `Upload failed (${response.status}).`, response.status);
  return body;
}
export async function sendVideo(file: Blob, session: UploadSession, token: string, progress: (fraction: number) => void, request: Fetcher = fetch) {
  const total = Math.ceil(file.size / session.chunkBytes);
  // Older running servers already accept duplicate chunks safely, but lack the resume query.
  // Keep in-flight calibrations usable during a frontend update without restarting the backend.
  const status = await cameraRequest(`/uploads/${session.uploadId}`, token, {}, request).catch(cause => {
    if (cause instanceof CameraRequestError && cause.status === 501) return { received: [], receipt: null };
    throw cause;
  });
  if (status.receipt) { progress(1); return status.receipt; }
  const received = new Set<number>(status.received ?? []);
  for (let index = 0; index < total; index++) {
    if (received.has(index)) { progress(Math.min(file.size, (index + 1) * session.chunkBytes) / file.size); continue; }
    const chunk = file.slice(index * session.chunkBytes, (index + 1) * session.chunkBytes);
    const digest = await crypto.subtle.digest("SHA-256", await chunk.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    await cameraRequest(`/uploads/${session.uploadId}/${index}`, token, { method: "PUT", headers: { "x-chunk-sha256": sha256 }, body: chunk }, request);
    progress(Math.min(file.size, (index + 1) * session.chunkBytes) / file.size);
  }
  return cameraRequest(`/uploads/${session.uploadId}/complete`, token, { method: "POST" }, request);
}
