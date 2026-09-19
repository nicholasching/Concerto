import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { AdminSnapshot, ApiError, CommandAccepted, PROTOCOL_VERSION, type OtcResultData } from "@orchestra/contracts";
import { createApp, DEFAULT_LEAD_TIME_MS } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry } from "../src/connections";
import { JobRunner, type SpawnWorker } from "../src/jobs";
import { AudioLease } from "../src/lease";
import { Preparations } from "../src/preparations";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const EPOCH = "epoch-a";

let directory: string;
let serverMs: number;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-map-"));
  serverMs = 1_000_000;
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const emptyStream = () => new ReadableStream<Uint8Array>({ start: controller => controller.close() });

// A worker that writes whatever result the test asks for, keyed by the manifest it is given.
const workerWriting = (build: (manifest: Record<string, never>) => OtcResultData): SpawnWorker => args => {
  const manifestPath = args[args.indexOf("--manifest") + 1];
  const outputPath = args[args.indexOf("--output") + 1];
  const exited = (async () => {
    const manifest = JSON.parse(await Bun.file(manifestPath).text());
    await Bun.write(outputPath, JSON.stringify(build(manifest)));
    return 0;
  })();
  return { stdout: emptyStream(), stderr: emptyStream(), exited, kill() {} };
};

const localized = (deviceId: number, x: number, y: number) => ({
  deviceId, column: "left" as const, sourceCameraIds: ["camera-left"], decodeScore: 0.9,
  mappingResidualPx: 2, status: "localized" as const, x, y, mappingMode: "manual-anchors" as const,
});

const resultFor = (manifest: Record<string, never>, locations: unknown[]): OtcResultData => ({
  protocolVersion: 1,
  sessionId: manifest["sessionId"] as unknown as string,
  serverEpoch: manifest["serverEpoch"] as unknown as string,
  runId: manifest["runId"] as unknown as string,
  runTag: manifest["runTag"] as unknown as number,
  evidence: "synthetic", decoderVersion: "test-0.1",
  inputHashes: (manifest["cameras"] as unknown as { cameraId: string; sha256: string }[])
    .map(camera => ({ cameraId: camera.cameraId, sha256: camera.sha256 })),
  observations: [], locations: locations.filter(location => (manifest["participantIds"] as unknown as number[]).includes((location as { deviceId: number }).deviceId)) as never, cameras: [], warnings: [], processingMs: 10,
});

const harness = (spawn: SpawnWorker) => {
  const clock: ServerClock = { sessionId: SESSION, serverEpoch: EPOCH, nowServerMs: () => serverMs };
  const state = new SessionState();
  const calibrations = new CalibrationRuns();
  const preparations = new Preparations();
  const connections = new ConnectionRegistry();
  const store = new CheckpointStore(joinPath(directory, "checkpoint.json"));
  const jobs = new JobRunner({ spawn, now: () => serverMs });
  const app = createApp({
    clock, state, calibrations, preparations, connections, store, jobs, operatorSecret: SECRET,
    jobWorkspace: joinPath(directory, "jobs"),
    lease: new AudioLease(),
    registry: new DeviceRegistry(),
    joins: new RateLimiter(100, 100, () => serverMs),
    commands: new CommandLog(),
    assets: new AssetStore(joinPath(directory, "assets")),
    uploads: new AssetStore(joinPath(directory, "uploads")),
  });
  for (const deviceId of [0, 1, 2]) {
    state.register(deviceId);
    state.setConnected(deviceId, true);
    connections.bindParticipant(deviceId, { send() {}, close() {} });
  }
  return { app, state, calibrations, preparations, store, jobs, clock };
};

type Harness = ReturnType<typeof harness>;

const operator = (app: Harness["app"], path: string, body: Record<string, unknown>) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-operator-secret": SECRET },
    body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, sessionId: SESSION, serverEpoch: EPOCH, ...body }),
  });

// Drives a whole run: create, acknowledge, arm, upload, process.
const runThrough = async (context: Harness, options: { participantIds: number[]; commandPrefix: string }) => {
  const created = await (await operator(context.app, "/api/calibrations", {
    commandId: `${options.commandPrefix}-run`, expectedRevision: 0, participantIds: options.participantIds,
    palette: { zero: "#1020ff", one: "#ff2010", neutral: "#101010" }, paletteVersion: "palette-v1",
  })).json();
  const runId = created.plan.runId;
  const preparationId = created.preparationId;
  context.preparations.current("calibration")!.acknowledgePreparation({
    deviceId: options.participantIds[0], preparationId, ready: true, reason: null,
  });
  await operator(context.app, `/api/calibrations/${runId}/arm`, {
    commandId: `${options.commandPrefix}-arm`, expectedRevision: 0, runId, preparationId,
    effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
  });

  const bytes = new Uint8Array(64);
  const query = new URLSearchParams({
    commandId: `${options.commandPrefix}-upload`, cameraId: "camera-left", primaryColumn: "left",
    rotationDegrees: "0", byteSize: "64", label: "clip.mp4",
  });
  const upload = await (await context.app.request(`/api/calibrations/${runId}/uploads?${query}`, {
    method: "POST", headers: { "x-operator-secret": SECRET }, body: bytes.buffer as ArrayBuffer,
  })).json();

  const job = await (await operator(context.app, `/api/calibrations/${runId}/jobs`, {
    commandId: `${options.commandPrefix}-job`, expectedRevision: 0, runId, uploadIds: [upload.uploadId], evidence: "synthetic",
  })).json();

  for (let i = 0; i < 200; i++) {
    const stage = context.jobs.get(job.jobId)?.stage;
    if (stage === "complete" || stage === "failed") break;
    await Bun.sleep(5);
  }
  return { runId, jobId: job.jobId };
};

const commitMap = (context: Harness, options: {
  runId: string; jobId: string; commandId: string; expectedMapRevision?: number;
}) =>
  operator(context.app, `/api/calibrations/${options.runId}/commit-map`, {
    commandId: options.commandId, expectedRevision: 0, runId: options.runId, jobId: options.jobId,
    expectedMapRevision: options.expectedMapRevision ?? 0,
  });

describe("committing a map", () => {
  test("a late interrupted-pattern report invalidates a candidate that included that phone", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const { runId, jobId } = await runThrough(context, { participantIds: [0], commandPrefix: "late-report" });
    context.calibrations.get(runId)!.reports.set(0, { deviceId: 0, completed: false, maxFrameLatenessMs: 500, reason: "hidden" });
    const response = await commitMap(context, { runId, jobId, commandId: "late-report-commit" });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CAPTURE_CHANGED");
    expect(context.state.mapRevision).toBe(0);
  });
  test("places the devices the run could see and leaves the rest alone", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const { runId, jobId } = await runThrough(context, { participantIds: [0, 1], commandPrefix: "a" });

    const accepted = CommandAccepted.parse(await (await commitMap(context, { runId, jobId, commandId: "commit-1" })).json());

    expect(accepted.revision).toBe(1);
    expect(context.state.mapRevision).toBe(1);
    const map = context.state.audienceMap;
    expect(map.locations.find(location => location.deviceId === 0)).toMatchObject({ status: "localized", x: 0.2, y: 0.6 });
    // Device 1 was targeted and not decoded: unknown, never a position.
    expect(map.locations.find(location => location.deviceId === 1)).toMatchObject({ status: "unseen", x: null, y: null });
    // Device 2 was never in the run at all.
    expect(map.locations.find(location => location.deviceId === 2)).toMatchObject({ status: "unseen" });
  });

  test("keeps a previous position for a device outside the new run", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6), localized(1, 0.8, 0.3)])));
    const first = await runThrough(context, { participantIds: [0, 1], commandPrefix: "a" });
    await commitMap(context, { runId: first.runId, jobId: first.jobId, commandId: "commit-1" });

    // A second run that targets only device 1 must not disturb device 0.
    const second = await runThrough(context, { participantIds: [1], commandPrefix: "b" });
    await commitMap(context, { runId: second.runId, jobId: second.jobId, commandId: "commit-2", expectedMapRevision: 1 });

    const map = context.state.audienceMap;
    expect(map.locations.find(location => location.deviceId === 0)).toMatchObject({ status: "localized", x: 0.2 });
    expect(map.mapRevision).toBe(2);
  });

  test("refuses a stale expected map revision", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const first = await runThrough(context, { participantIds: [0, 1], commandPrefix: "a" });
    await commitMap(context, { runId: first.runId, jobId: first.jobId, commandId: "commit-1" });
    const second = await runThrough(context, { participantIds: [0], commandPrefix: "b" });

    const response = await commitMap(context, {
      runId: second.runId, jobId: second.jobId, commandId: "commit-2", expectedMapRevision: 0,
    });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("REVISION_CONFLICT");
    expect(context.state.mapRevision).toBe(1);
  });

  test("refuses a result that describes a different run", async () => {
    const context = harness(workerWriting(manifest => ({
      ...resultFor(manifest, [localized(0, 0.2, 0.6)]), runTag: 250,
    })));
    const { runId, jobId } = await runThrough(context, { participantIds: [0], commandPrefix: "a" });

    // The job already refused it, so there is nothing to commit.
    expect(context.jobs.get(jobId)?.stage).toBe("failed");
    const response = await commitMap(context, { runId, jobId, commandId: "commit-1" });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("JOB_NOT_COMPLETE");
    expect(context.state.mapRevision).toBe(0);
  });

  test("refuses a job that belongs to another run", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const first = await runThrough(context, { participantIds: [0], commandPrefix: "a" });
    await commitMap(context, { runId: first.runId, jobId: first.jobId, commandId: "commit-1" });
    const second = await runThrough(context, { participantIds: [0], commandPrefix: "b" });

    const response = await commitMap(context, {
      runId: second.runId, jobId: first.jobId, commandId: "commit-2", expectedMapRevision: 1,
    });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("UNKNOWN_JOB");
  });

  test("an older run cannot overwrite what a newer one already committed", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const older = await runThrough(context, { participantIds: [0], commandPrefix: "a" });
    await commitMap(context, { runId: older.runId, jobId: older.jobId, commandId: "commit-older" });
    const newer = await runThrough(context, { participantIds: [0], commandPrefix: "b" });
    await commitMap(context, { runId: newer.runId, jobId: newer.jobId, commandId: "commit-newer", expectedMapRevision: 1 });

    // The older run's result is re-submitted after the newer map is already in use.
    const response = await commitMap(context, {
      runId: older.runId, jobId: older.jobId, commandId: "commit-older-again", expectedMapRevision: 2,
    });

    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("STALE_RUN");
    expect(context.state.mapRevision).toBe(2);
  });

  test("a retried commit applies once", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const { runId, jobId } = await runThrough(context, { participantIds: [0], commandPrefix: "a" });

    const first = CommandAccepted.parse(await (await commitMap(context, { runId, jobId, commandId: "commit-1" })).json());
    const retry = CommandAccepted.parse(await (await commitMap(context, { runId, jobId, commandId: "commit-1" })).json());

    expect(retry).toEqual(first);
    expect(context.state.mapRevision).toBe(1);
  });

  test("a committed map appears in the operator snapshot and survives a restart", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const { runId, jobId } = await runThrough(context, { participantIds: [0], commandPrefix: "a" });
    await commitMap(context, { runId, jobId, commandId: "commit-1" });

    const snapshot = AdminSnapshot.parse(await (await context.app.request(`/api/sessions/${SESSION}/snapshot`, {
      headers: { "x-operator-secret": SECRET },
    })).json());
    expect(snapshot.audienceMap.mapRevision).toBe(1);
    expect(snapshot.audienceMap.runId).toBe(runId);

    const checkpoint = await context.store.read();
    if (!checkpoint?.map) throw new Error("expected a persisted map");
    const restored = new SessionState();
    restored.restoreMap(checkpoint.map, checkpoint.committedRunTag);
    expect(restored.mapRevision).toBe(1);
    expect(restored.lastCommittedRunTag).toBe(0);
  });
});

describe("a committed map makes earlier selections stale", () => {
  test("an assignment built against the previous map is refused afterwards", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const assign = (commandId: string, mapRevision: number) =>
      operator(context.app, "/api/assignments", {
        commandId, expectedRevision: 0, mapRevision, deviceIds: [0], channelId: null,
        effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
      });

    expect((await assign("assign-before", 0)).status).toBe(200);

    const { runId, jobId } = await runThrough(context, { participantIds: [0], commandPrefix: "a" });
    await commitMap(context, { runId, jobId, commandId: "commit-1" });

    // The assignment domain has moved on too, so this names its current revision and still fails
    // on the map alone.
    const stale = await operator(context.app, "/api/assignments", {
      commandId: "assign-after", expectedRevision: 1, mapRevision: 0, deviceIds: [0], channelId: null,
      effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
    });
    expect(stale.status).toBe(409);
    expect(ApiError.parse(await stale.json()).error.code).toBe("STALE_MAP");

    const reselected = await operator(context.app, "/api/assignments", {
      commandId: "assign-reselected", expectedRevision: 1, mapRevision: 1, deviceIds: [0], channelId: null,
      effectiveServerMs: serverMs + DEFAULT_LEAD_TIME_MS,
    });
    expect(reselected.status).toBe(200);
  });
});

describe("discarding a run", () => {
  test("frees the session after a calibration that cannot be committed", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [])));
    const { runId } = await runThrough(context, { participantIds: [0], commandPrefix: "a" });

    // A second run is blocked while the first is still open.
    const blocked = await operator(context.app, "/api/calibrations", {
      commandId: "b-run", expectedRevision: 0, participantIds: [0],
      palette: { zero: "#1020ff", one: "#ff2010", neutral: "#101010" }, paletteVersion: "palette-v1",
    });
    expect(blocked.status).toBe(409);

    const discarded = await context.app.request(`/api/calibrations/${runId}`, {
      method: "DELETE", headers: { "x-operator-secret": SECRET },
    });
    expect(discarded.status).toBe(200);

    const retried = await operator(context.app, "/api/calibrations", {
      commandId: "c-run", expectedRevision: 0, participantIds: [0],
      palette: { zero: "#1020ff", one: "#ff2010", neutral: "#101010" }, paletteVersion: "palette-v1",
    });
    expect(retried.status).toBe(200);
  });

  test("refuses to discard a run whose map is already in use", async () => {
    const context = harness(workerWriting(manifest => resultFor(manifest, [localized(0, 0.2, 0.6)])));
    const { runId, jobId } = await runThrough(context, { participantIds: [0], commandPrefix: "a" });
    await commitMap(context, { runId, jobId, commandId: "commit-1" });

    const response = await context.app.request(`/api/calibrations/${runId}`, {
      method: "DELETE", headers: { "x-operator-secret": SECRET },
    });
    expect(response.status).toBe(409);
    expect(ApiError.parse(await response.json()).error.code).toBe("RUN_ALREADY_COMMITTED");
  });
});
