import { readFile } from "node:fs/promises";
import { z } from "zod";
import { OtcResult, type CalibrationManifestData, type OtcResultData } from "@orchestra/contracts";

export type JobStage = z.infer<typeof OtcStage>;
const OtcStage = z.enum(["queued", "validate", "decode", "track", "register", "complete", "failed", "cancelled"]);

// What a worker prints on stdout to report progress. Anything else on the stream is kept as a
// diagnostic rather than being interpreted.
const ProgressLine = z.object({
  stage: OtcStage,
  progress: z.number().min(0).max(1),
  message: z.string().default(""),
});

export interface WorkerProcess {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
  kill(): void;
}

export type SpawnWorker = (args: string[]) => WorkerProcess;

export interface JobRecord {
  jobId: string;
  runId: string;
  stage: JobStage;
  progress: number;
  message: string;
  diagnostics: string[];
  result: OtcResultData | null;
  startedServerMs: number | null;
  finishedServerMs: number | null;
}

export const workerCommand = (): string[] =>
  (process.env.OTC_COMMAND ?? "python -m otc process").split(" ").filter(Boolean);

// The worker is always spawned with an argument array. A path or filename can therefore never be
// interpreted as shell syntax, whatever an operator names a file.
export const spawnWorker: SpawnWorker = args => Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

const drain = async (stream: ReadableStream<Uint8Array> | null, onLine: (line: string) => void) => {
  if (!stream) return;
  let buffered = "";
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onLine(line);
  }
  if (buffered.trim()) onLine(buffered);
};

export class JobRunner {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly running = new Map<string, WorkerProcess>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly options: {
      spawn?: SpawnWorker;
      command?: string[];
      timeoutMs?: number;
      now?: () => number;
      maxDiagnostics?: number;
    } = {},
  ) {}

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  // Jobs run one at a time. Decoding three 4K clips saturates the machine, and two concurrent
  // decodes would make both slower and starve the control process that is holding the sockets.
  enqueue(input: { jobId: string; runId: string; manifestPath: string; outputPath: string; manifest: CalibrationManifestData }): JobRecord {
    const now = this.options.now ?? Date.now;
    const record: JobRecord = {
      jobId: input.jobId, runId: input.runId, stage: "queued", progress: 0, message: "queued",
      diagnostics: [], result: null, startedServerMs: null, finishedServerMs: null,
    };
    this.jobs.set(input.jobId, record);
    const next = this.queue.catch(() => {}).then(() => this.run(input, record, now));
    this.queue = next.catch(() => {});
    return record;
  }

  cancel(jobId: string): boolean {
    const record = this.jobs.get(jobId);
    if (!record || record.stage === "complete" || record.stage === "failed" || record.stage === "cancelled") return false;
    record.stage = "cancelled";
    record.message = "cancelled by the operator";
    this.running.get(jobId)?.kill();
    return true;
  }

  private fail(record: JobRecord, message: string, now: () => number): void {
    if (this.jobs.get(record.jobId)?.stage === "cancelled") return;
    record.stage = "failed";
    record.message = message;
    record.finishedServerMs = now();
  }

  private async run(
    input: { jobId: string; runId: string; manifestPath: string; outputPath: string; manifest: CalibrationManifestData },
    record: JobRecord,
    now: () => number,
  ): Promise<void> {
    // Read through the map: cancel() can change the stage while this is awaiting, which narrowing
    // on the local record would hide.
    const cancelled = () => this.jobs.get(input.jobId)?.stage === "cancelled";
    if (cancelled()) return;
    record.stage = "validate";
    record.startedServerMs = now();

    const command = this.options.command ?? workerCommand();
    const child = (this.options.spawn ?? spawnWorker)([
      ...command, "--manifest", input.manifestPath, "--output", input.outputPath,
    ]);
    this.running.set(input.jobId, child);

    const maxDiagnostics = this.options.maxDiagnostics ?? 200;
    const note = (line: string) => {
      if (record.diagnostics.length < maxDiagnostics) record.diagnostics.push(line);
    };

    const timeoutMs = this.options.timeoutMs ?? 600_000;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    try {
      await Promise.all([
        drain(child.stdout, line => {
          // A worker is free to print things that are not progress. Parsing must never throw out
          // of here: doing so would abandon the rest of the stream and leave the job looking hung.
          let decoded: unknown;
          try {
            decoded = JSON.parse(line.trim());
          } catch {
            return note(line);
          }
          const parsed = ProgressLine.safeParse(decoded);
          if (!parsed.success) return note(line);
          if (cancelled()) return;
          record.stage = parsed.data.stage;
          record.progress = parsed.data.progress;
          record.message = parsed.data.message;
        }),
        drain(child.stderr, note),
      ]).catch(cause => {
        note(`stream ended early: ${(cause as Error).message}`);
      });
      const exitCode = await child.exited;
      clearTimeout(timer);

      if (timedOut) return this.fail(record, `worker exceeded ${timeoutMs} ms and was stopped`, now);
      if (cancelled()) return;
      if (exitCode !== 0) return this.fail(record, `worker exited with code ${exitCode}`, now);

      const raw = await readFile(input.outputPath, "utf8").catch(() => null);
      if (raw === null) return this.fail(record, "worker exited successfully but wrote no result", now);

      let parsed: OtcResultData;
      try {
        parsed = OtcResult.parse(JSON.parse(raw));
      } catch {
        return this.fail(record, "worker result did not match the OtcResult schema", now);
      }

      // A result that does not describe the run we asked about is never merged into anything.
      const mismatch = identityMismatch(parsed, input.manifest);
      if (mismatch) return this.fail(record, mismatch, now);

      record.result = parsed;
      record.stage = "complete";
      record.progress = 1;
      record.message = "complete";
      record.finishedServerMs = now();
    } catch (cause) {
      clearTimeout(timer);
      this.fail(record, `worker could not be run: ${(cause as Error).message}`, now);
    } finally {
      this.running.delete(input.jobId);
    }
  }
}

export const identityMismatch = (result: OtcResultData, manifest: CalibrationManifestData): string | null => {
  if (result.sessionId !== manifest.sessionId) return "result belongs to a different session";
  if (result.runId !== manifest.runId) return "result belongs to a different calibration run";
  if (result.runTag !== manifest.runTag) return "result carries a different run tag";

  const expected = new Map(manifest.cameras.map(camera => [camera.cameraId, camera.sha256]));
  for (const input of result.inputHashes) {
    if (expected.get(input.cameraId) !== input.sha256) return `result was produced from different bytes for ${input.cameraId}`;
  }
  if (result.inputHashes.length !== expected.size) return "result does not account for every uploaded recording";
  return null;
};
