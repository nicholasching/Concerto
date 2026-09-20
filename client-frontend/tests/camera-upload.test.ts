import { expect, test } from "bun:test";
import { sendVideo } from "../src/lib/camera-upload";

test("phone upload sends ordered hashed chunks then completes only after delivery", async () => {
  const chunks: string[] = []; const paths: string[] = []; const progress: number[] = [];
  const request: typeof fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    paths.push(String(input));
    if (init?.body instanceof Blob) {
      chunks.push(await init.body.text());
      expect((init.headers as Record<string, string>)["x-chunk-sha256"]).toHaveLength(64);
      expect((init.headers as Record<string, string>)["x-upload-token"]).toBe("camera-only");
    }
    return Response.json({ ok: true });
  }, { preconnect() {} });
  await sendVideo(new Blob(["abcdefghij"]), { uploadId: "test", chunkBytes: 4 }, "camera-only", fraction => progress.push(fraction), request);
  expect(chunks).toEqual(["abcd", "efgh", "ij"]); expect(progress).toEqual([0.4, 0.8, 1]); expect(paths.at(-1)).toBe("/api/camera/uploads/test/complete");
});

test("retry resumes verified chunks and recovers a completed receipt without resending video", async () => {
  const paths: string[] = []; const progress: number[] = [];
  let completed = false;
  const request: typeof fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input); paths.push(path);
    if (!init?.method) return Response.json({ received: [0, 1], receipt: completed ? { uploadId: "resume" } : null });
    if (init.body instanceof Blob) expect(await init.body.text()).toBe("ij");
    if (path.endsWith("/complete")) { completed = true; return Response.json({ uploadId: "resume" }); }
    return Response.json({ ok: true });
  }, { preconnect() {} });
  const file = new Blob(["abcdefghij"]), session = { uploadId: "resume", chunkBytes: 4 };
  expect(await sendVideo(file, session, "camera-only", value => progress.push(value), request)).toEqual({ uploadId: "resume" });
  expect(paths).toEqual(["/api/camera/uploads/resume", "/api/camera/uploads/resume/2", "/api/camera/uploads/resume/complete"]);
  paths.length = 0;
  expect(await sendVideo(file, session, "camera-only", value => progress.push(value), request)).toEqual({ uploadId: "resume" });
  expect(paths).toEqual(["/api/camera/uploads/resume"]);
  expect(progress.at(-1)).toBe(1);
});

test("a running server without a resume query still receives and completes the video", async () => {
  const paths: string[] = [];
  const request: typeof fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
    paths.push(String(input));
    if (!init?.method) return Response.json({ error: { message: "That API route is not implemented by the sync-control service." } }, { status: 501 });
    return Response.json({ ok: true });
  }, { preconnect() {} });
  await sendVideo(new Blob(["abc"]), { uploadId: "live", chunkBytes: 4 }, "camera-only", () => {}, request);
  expect(paths).toEqual(["/api/camera/uploads/live", "/api/camera/uploads/live/0", "/api/camera/uploads/live/complete"]);
});
