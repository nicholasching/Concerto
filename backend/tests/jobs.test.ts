import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import type { CalibrationManifestData, OtcResultData } from "@orchestra/contracts";
import { identityMismatch, JobRunner, type SpawnWorker, type WorkerProcess } from "../src/jobs";

const SESSION = "session-under-test";
let directory: string;
let serverMs: number;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-jobs-"));
  serverMs = 1_000_000;
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const streamOf = (lines: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) controller.enqueue(encoder.encode(`${line}\n`));
      controller.close();
    },
  });

const manifest = (overrides: Partial<CalibrationManifestData> = {}): CalibrationManifestData => ({
  protocolVersion: 1, sessionId: SESSION, serverEpoch: "epoch-a",
  runId: "run-1", runTag: 3, participantIds: [0, 1], startServerMs: 2_000_000,
  packetVersion: "otc-v1", codebookVersion: "hamming16-11-v1", paletteVersion: "palette-v1",
  palette: { zero: "#1020ff", one: "#ff2010", neutral: "#101010" }, symbolMs: 200,
  cameras: [{
    cameraId: "camera-left", primaryColumn: "left", videoPath: "/srv/uploads/abc", sha256: "a".repeat(64),
    rotationDegrees: 0, exclusionRois: [], anchors: null,
  }],
  ...overrides,
});

const result = (overrides: Partial<OtcResultData> = {}): OtcResultData => ({
  protocolVersion: 1, sessionId: SESSION, serverEpoch: "epoch-a", runId: "run-1", runTag: 3,
  evidence: "synthetic", decoderVersion: "otc-0.1",
  inputHashes: [{ cameraId: "camera-left", sha256: "a".repeat(64) }],
  observations: [], locations: [], cameras: [], warnings: [], processingMs: 1200,
  ...overrides,
});

interface FakeOptions {
  stdout?: string[];
  stderr?: string[];
  exitCode?: number;
  writes?: OtcResultData | string | null;
  hang?: boolean;
}

const fakeWorker = (options: FakeOptions = {}) => {
  const calls: string[][] = [];
  let killed = false;
  const spawn: SpawnWorker = args => {
    calls.push(args);
    const outputPath = args[args.indexOf("--output") + 1];
    let settle: (code: number) => void = () => {};
    const exited = new Promise<number>(resolve => {
      settle = resolve;
      if (options.hang) return;
      void (async () => {
        if (options.writes !== null && options.writes !== undefined) {
          const body = typeof options.writes === "string" ? options.writes : JSON.stringify(options.writes);
          await writeFile(outputPath, body, "utf8");
        }
        resolve(options.exitCode ?? 0);
      })();
    });
    const process: WorkerProcess = {
      stdout: streamOf(options.stdout ?? []),
      stderr: streamOf(options.stderr ?? []),
      exited,
      kill() {
        killed = true;
        settle(143);
      },
    };
    return process;
  };
  return { spawn, calls, wasKilled: () => killed };
};

const settle = async (runner: JobRunner, jobId: string) => {
  for (let i = 0; i < 200; i++) {
    const stage = runner.get(jobId)?.stage;
    if (stage === "complete" || stage === "failed" || stage === "cancelled") return runner.get(jobId)!;
    await Bun.sleep(5);
  }
  throw new Error(`job ${jobId} never settled; stage is ${runner.get(jobId)?.stage}`);
};

const enqueue = async (runner: JobRunner, jobId = "job-1", manifestData = manifest()) => {
  await mkdir(directory, { recursive: true });
  const manifestPath = joinPath(directory, `${jobId}.manifest.json`);
  const outputPath = joinPath(directory, `${jobId}.result.json`);
  await writeFile(manifestPath, JSON.stringify(manifestData), "utf8");
  return runner.enqueue({ jobId, runId: manifestData.runId, manifestPath, outputPath, manifest: manifestData });
};

describe("the worker boundary", () => {
  test("spawns an argument array, so a hostile path can never become shell syntax", async () => {
    const worker = fakeWorker({ writes: result() });
    const runner = new JobRunner({ spawn: worker.spawn, command: ["python", "-m", "otc", "process"], now: () => serverMs });
    const hostile = manifest({
      cameras: [{
        cameraId: "camera-left", primaryColumn: "left",
        videoPath: "/srv/uploads/$(rm -rf /); touch pwned", sha256: "a".repeat(64),
        rotationDegrees: 0, exclusionRois: [], anchors: null,
      }],
    });
    await enqueue(runner, "job-1", hostile);
    await settle(runner, "job-1");

    const args = worker.calls[0];
    expect(args.slice(0, 4)).toEqual(["python", "-m", "otc", "process"]);
    // The manifest path is one argument; the hostile string never reaches a shell at all.
    expect(args.filter(argument => argument.includes("rm -rf"))).toEqual([]);
    expect(args).toContain("--manifest");
    expect(args).toContain("--output");
  });

  test("reports structured progress and keeps unrecognised output as diagnostics", async () => {
    const worker = fakeWorker({
      stdout: [
        JSON.stringify({ stage: "decode", progress: 0.4, message: "decoding camera-left" }),
        "ffmpeg: stray line that is not progress",
      ],
      stderr: ["warning: exposure drift on camera-left"],
      writes: result(),
    });
    const runner = new JobRunner({ spawn: worker.spawn, now: () => serverMs });
    await enqueue(runner);
    const record = await settle(runner, "job-1");

    expect(record.stage).toBe("complete");
    expect(record.progress).toBe(1);
    expect(record.diagnostics).toContain("ffmpeg: stray line that is not progress");
    expect(record.diagnostics).toContain("warning: exposure drift on camera-left");
  });

  test("stores a schema-valid result", async () => {
    const worker = fakeWorker({ writes: result({ processingMs: 4321 }) });
    const runner = new JobRunner({ spawn: worker.spawn, now: () => serverMs });
    await enqueue(runner);
    const record = await settle(runner, "job-1");

    expect(record.stage).toBe("complete");
    expect(record.result?.processingMs).toBe(4321);
    expect(record.finishedServerMs).toBe(serverMs);
  });

  test("a non-zero exit fails the job and preserves what the worker said", async () => {
    const worker = fakeWorker({ exitCode: 2, stderr: ["Traceback: no such file"], writes: null });
    const runner = new JobRunner({ spawn: worker.spawn, now: () => serverMs });
    await enqueue(runner);
    const record = await settle(runner, "job-1");

    expect(record.stage).toBe("failed");
    expect(record.message).toContain("code 2");
    expect(record.diagnostics).toContain("Traceback: no such file");
    expect(record.result).toBeNull();
  });

  test("a successful exit with no result is a failure, not a success", async () => {
    const worker = fakeWorker({ writes: null });
    const runner = new JobRunner({ spawn: worker.spawn, now: () => serverMs });
    await enqueue(runner);
    const record = await settle(runner, "job-1");

    expect(record.stage).toBe("failed");
    expect(record.message).toContain("no result");
  });

  test("a result that does not match the schema is rejected", async () => {
    const worker = fakeWorker({ writes: '{"protocolVersion":1,"nonsense":true}' });
    const runner = new JobRunner({ spawn: worker.spawn, now: () => serverMs });
    await enqueue(runner);
    const record = await settle(runner, "job-1");

    expect(record.stage).toBe("failed");
    expect(record.message).toContain("OtcResult schema");
  });

  test("a worker that runs too long is stopped and reported", async () => {
    const worker = fakeWorker({ hang: true });
    const runner = new JobRunner({ spawn: worker.spawn, timeoutMs: 30, now: () => serverMs });
    await enqueue(runner);
    const record = await settle(runner, "job-1");

    expect(worker.wasKilled()).toBe(true);
    expect(record.stage).toBe("failed");
    expect(record.message).toContain("exceeded 30 ms");
  });

  test("a cancelled job stops and never produces a result", async () => {
    const worker = fakeWorker({ hang: true });
    const runner = new JobRunner({ spawn: worker.spawn, now: () => serverMs });
    await enqueue(runner);
    await Bun.sleep(10);

    expect(runner.cancel("job-1")).toBe(true);
    const record = await settle(runner, "job-1");

    expect(record.stage).toBe("cancelled");
    expect(record.result).toBeNull();
    expect(worker.wasKilled()).toBe(true);
    expect(runner.cancel("job-1")).toBe(false);
  });

  test("jobs run one at a time rather than competing for the machine", async () => {
    let concurrent = 0;
    let peak = 0;
    const spawn: SpawnWorker = args => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      const outputPath = args[args.indexOf("--output") + 1];
      const exited = (async () => {
        await Bun.sleep(20);
        await writeFile(outputPath, JSON.stringify(result()), "utf8");
        concurrent--;
        return 0;
      })();
      return { stdout: streamOf([]), stderr: streamOf([]), exited, kill() {} };
    };
    const runner = new JobRunner({ spawn, now: () => serverMs });
    await enqueue(runner, "job-1");
    await enqueue(runner, "job-2");
    await settle(runner, "job-1");
    await settle(runner, "job-2");

    expect(peak).toBe(1);
    expect(runner.get("job-2")?.stage).toBe("complete");
  });
});

describe("result identity", () => {
  test("accepts a result describing the run that was sent", () => {
    expect(identityMismatch(result(), manifest())).toBeNull();
  });

  test("rejects a result from another session, run or tag", () => {
    expect(identityMismatch(result({ sessionId: "other" }), manifest())).toContain("session");
    expect(identityMismatch(result({ runId: "other" }), manifest())).toContain("run");
    expect(identityMismatch(result({ runTag: 9 }), manifest())).toContain("run tag");
  });

  test("rejects a result produced from different bytes", () => {
    const tampered = result({ inputHashes: [{ cameraId: "camera-left", sha256: "b".repeat(64) }] });
    expect(identityMismatch(tampered, manifest())).toContain("different bytes");
  });

  test("rejects a result that ignores one of the recordings", () => {
    const twoCameras = manifest({
      cameras: [
        { cameraId: "camera-left", primaryColumn: "left", videoPath: "/a", sha256: "a".repeat(64), rotationDegrees: 0, exclusionRois: [], anchors: null },
        { cameraId: "camera-right", primaryColumn: "right", videoPath: "/b", sha256: "c".repeat(64), rotationDegrees: 0, exclusionRois: [], anchors: null },
      ],
    });
    expect(identityMismatch(result(), twoCameras)).toContain("every uploaded recording");
  });

  test("a job whose result describes a different run fails instead of storing it", async () => {
    const worker = fakeWorker({ writes: result({ runTag: 200 }) });
    const runner = new JobRunner({ spawn: worker.spawn, now: () => serverMs });
    await enqueue(runner);
    const record = await settle(runner, "job-1");

    expect(record.stage).toBe("failed");
    expect(record.message).toContain("run tag");
    expect(record.result).toBeNull();
  });
});
