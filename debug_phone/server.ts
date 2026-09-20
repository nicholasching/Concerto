import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// `qrcode` is already the participant frontend's declared dependency. This
// standalone tool stays out of the root workspace, so resolve that installed
// package explicitly instead of changing shared workspace/lockfile metadata.
const require = createRequire(import.meta.url);
const QRCode: typeof import("qrcode") = require("../client-frontend/node_modules/qrcode");

const publicRoot = fileURLToPath(new URL("./public/", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const boxingRoot = join(repositoryRoot, "runtime", "debug-phone-boxing");
const port = Number(Bun.env.DEBUG_PHONE_PORT ?? "3002");
const maxBoxingUploadBytes = 512 * 1024 * 1024;

type BoxingJob = {
  status: "running" | "complete" | "failed";
  workspace: string;
  outputPath: string;
  error?: string;
  summary?: Record<string, unknown>;
};

const boxingJobs = new Map<string, BoxingJob>();

const assets = new Map([
  ["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", contentType: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/packet.js", { file: "packet.js", contentType: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
  ["/detection-boxing", { file: "../detection_boxing/index.html", contentType: "text/html; charset=utf-8" }],
  ["/detection-boxing/", { file: "../detection_boxing/index.html", contentType: "text/html; charset=utf-8" }],
  ["/detection-boxing/app.js", { file: "../detection_boxing/app.js", contentType: "text/javascript; charset=utf-8" }],
  ["/detection-boxing/styles.css", { file: "../detection_boxing/styles.css", contentType: "text/css; charset=utf-8" }],
]);

function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) return `${forwardedProtocol === "http" ? "http" : "https"}://${forwardedHost}`;
  return new URL(request.url).origin;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function localBoxingOnly(request: Request): boolean {
  return !request.headers.has("x-forwarded-host") && !request.headers.has("x-forwarded-proto");
}

function boxingId(pathname: string): string | null {
  const match = /^\/api\/boxing\/jobs\/([0-9a-f-]{36})(?:\/video)?$/.exec(pathname);
  return match?.[1] ?? null;
}

async function startBoxingJob(video: File, rotationDegrees: number): Promise<{ jobId: string }> {
  const jobId = crypto.randomUUID();
  const workspace = join(boxingRoot, jobId);
  const inputPath = join(workspace, "input.mp4");
  const outputPath = join(workspace, "boxed.mp4");
  await mkdir(workspace, { recursive: true });
  await Bun.write(inputPath, video);
  const job: BoxingJob = { status: "running", workspace, outputPath };
  boxingJobs.set(jobId, job);
  const python = process.platform === "win32"
    ? join(repositoryRoot, ".venv", "Scripts", "python.exe")
    : join(repositoryRoot, ".venv", "bin", "python");
  const child = Bun.spawn({
    cmd: [python, "-m", "otc", "box-video", "--input", inputPath, "--output", outputPath,
      "--rotation-degrees", String(rotationDegrees)],
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  void (async () => {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0 || !(await Bun.file(outputPath).exists())) {
      job.status = "failed";
      job.error = stderr.trim() || stdout.trim() || "Boxing worker did not create an annotated video.";
      return;
    }
    const completion = stdout.trim().split(/\r?\n/).map(line => {
      try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; }
    }).find(item => item?.boxed === true);
    job.status = "complete";
    if (completion) {
      const { output: _output, ...summary } = completion;
      job.summary = summary;
    } else {
      job.summary = { boxed: true };
    }
  })();
  return { jobId };
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: async request => {
    const url = new URL(request.url);
    const boxingPath = url.pathname.startsWith("/detection-boxing") || url.pathname.startsWith("/api/boxing/");
    if (boxingPath && !localBoxingOnly(request)) {
      return json({ error: "The clip boxing tool is local-only; open it on this computer." }, 403);
    }
    if (url.pathname === "/api/boxing/jobs" && request.method === "POST") {
      const declaredLength = Number(request.headers.get("content-length") ?? 0);
      if (declaredLength > maxBoxingUploadBytes) {
        return json({ error: "Videos must be 512 MiB or smaller." }, 413);
      }
      const form = await request.formData();
      const video = form.get("video");
      const rotationDegrees = Number(form.get("rotationDegrees") ?? 0);
      if (!(video instanceof File) || video.size === 0) {
        return json({ error: "Choose one non-empty video file." }, 400);
      }
      if (video.size > maxBoxingUploadBytes) return json({ error: "Videos must be 512 MiB or smaller." }, 413);
      if (![0, 90, 180, 270].includes(rotationDegrees)) {
        return json({ error: "Rotation must be 0, 90, 180, or 270 degrees." }, 400);
      }
      return json(await startBoxingJob(video, rotationDegrees), 202);
    }
    const jobId = boxingId(url.pathname);
    if (jobId && request.method === "GET") {
      const job = boxingJobs.get(jobId);
      if (!job) return json({ error: "Unknown or expired boxing job." }, 404);
      if (url.pathname.endsWith("/video")) {
        if (job.status !== "complete") return json({ error: "Annotated video is not ready." }, 409);
        return new Response(Bun.file(job.outputPath), { headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": "inline; filename=boxed.mp4",
          "Content-Type": "video/mp4",
        } });
      }
      return json({ jobId, status: job.status, error: job.error, summary: job.summary });
    }
    if (url.pathname === "/qr.svg") {
      const phoneUrl = new URL("/", publicOrigin(request)).toString();
      const svg = await QRCode.toString(phoneUrl, {
        type: "svg",
        width: 280,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      return new Response(svg, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "image/svg+xml",
          "X-Debug-Phone-Url": phoneUrl,
        },
      });
    }

    const asset = assets.get(url.pathname);
    if (!asset) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(join(publicRoot, asset.file)), {
      headers: { "Content-Type": asset.contentType },
    });
  },
});

console.log(`Debug phone flash bench: http://localhost:${server.port}`);
