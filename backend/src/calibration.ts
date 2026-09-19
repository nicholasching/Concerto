import { z } from "zod";
import { CalibrationPlan, Column } from "@orchestra/contracts";

type CalibrationPlanData = z.infer<typeof CalibrationPlan>;

export const MAX_CAMERAS = 3;
export const MAX_RUN_TAGS = 256;

export interface CameraUpload {
  uploadId: string;
  runId: string;
  cameraId: string;
  primaryColumn: z.infer<typeof Column>;
  rotationDegrees: 0 | 90 | 180 | 270;
  sha256: string;
  byteSize: number;
  label: string;
}

export type RunStatus = "created" | "armed" | "processing" | "committed" | "discarded";

export interface CalibrationRunRecord {
  plan: CalibrationPlanData;
  status: RunStatus;
  startServerMs: number | null;
  uploads: Map<string, CameraUpload>;
}

export type CreateOutcome =
  | { ok: true; run: CalibrationRunRecord }
  | { ok: false; code: "RUN_IN_PROGRESS" | "RUN_TAGS_EXHAUSTED" };

/**
 * Holds calibration runs for one session. Only one run is active at a time in the MVP, and a run
 * tag is never reused within a session: a stale clip from an earlier run has to be detectable,
 * and a reused tag would make an old recording look like it belongs to the current run.
 */
export class CalibrationRuns {
  private readonly runs = new Map<string, CalibrationRunRecord>();
  private nextRunTag = 0;

  create(input: {
    sessionId: string;
    serverEpoch: string;
    participantIds: number[];
    palette: CalibrationPlanData["palette"];
    paletteVersion: string;
  }): CreateOutcome {
    if (this.activeRun) return { ok: false, code: "RUN_IN_PROGRESS" };
    if (this.nextRunTag >= MAX_RUN_TAGS) return { ok: false, code: "RUN_TAGS_EXHAUSTED" };

    const plan = CalibrationPlan.parse({
      protocolVersion: 1, sessionId: input.sessionId, serverEpoch: input.serverEpoch,
      runId: crypto.randomUUID(), runTag: this.nextRunTag++,
      participantIds: input.participantIds,
      packetVersion: "otc-v1", codebookVersion: "hamming16-11-v1",
      paletteVersion: input.paletteVersion, palette: input.palette, symbolMs: 200,
    });
    const run: CalibrationRunRecord = { plan, status: "created", startServerMs: null, uploads: new Map() };
    this.runs.set(plan.runId, run);
    return { ok: true, run };
  }

  get(runId: string): CalibrationRunRecord | undefined {
    return this.runs.get(runId);
  }

  // Created, armed and processing runs all block a new one; finished runs do not.
  get activeRun(): CalibrationRunRecord | undefined {
    return [...this.runs.values()].find(run => run.status === "created" || run.status === "armed" || run.status === "processing");
  }

  arm(runId: string, startServerMs: number): void {
    const run = this.runs.get(runId);
    if (!run) return;
    run.status = "armed";
    run.startServerMs = startServerMs;
  }

  setStatus(runId: string, status: RunStatus): void {
    const run = this.runs.get(runId);
    if (run) run.status = status;
  }

  addUpload(upload: CameraUpload): void {
    this.runs.get(upload.runId)?.uploads.set(upload.uploadId, upload);
  }
}
