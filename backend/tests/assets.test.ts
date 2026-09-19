import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { ApiError, Track } from "@orchestra/contracts";
import { createApp } from "../src/app";
import { AssetStore } from "../src/assets";
import { CalibrationRuns } from "../src/calibration";
import { CheckpointStore } from "../src/checkpoint";
import type { ServerClock } from "../src/clock";
import { CommandLog } from "../src/commands";
import { ConnectionRegistry } from "../src/connections";
import { Preparations } from "../src/preparations";
import { DeviceRegistry } from "../src/registry";
import { RateLimiter } from "../src/rate-limit";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";
const SECRET = "operator-secret-for-tests";
const serverMs = 1_000_000;
const clock: ServerClock = { sessionId: SESSION, serverEpoch: "epoch-a", nowServerMs: () => serverMs };

let directory: string;
let assetDirectory: string;

beforeEach(async () => {
  directory = await mkdtemp(joinPath(tmpdir(), "orchestra-assets-"));
  assetDirectory = joinPath(directory, "assets");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const harness = () => {
  const assets = new AssetStore(assetDirectory);
  const app = createApp({
    clock, assets, operatorSecret: SECRET,
    uploads: new AssetStore(joinPath(directory, "uploads")),
    calibrations: new CalibrationRuns(),
    state: new SessionState(),
    registry: new DeviceRegistry(),
    store: new CheckpointStore(joinPath(directory, "checkpoint.json")),
    joins: new RateLimiter(100, 100, () => serverMs),
    commands: new CommandLog(),
    connections: new ConnectionRegistry(),
    preparations: new Preparations(),
  });
  return { app, assets };
};

const upload = (app: ReturnType<typeof createApp>, options: {
  bytes: Uint8Array; commandId?: string; declaredSize?: number; secret?: string; label?: string;
}) => {
  const query = new URLSearchParams({
    commandId: options.commandId ?? "asset-1",
    label: options.label ?? "Melody stem",
    byteSize: String(options.declaredSize ?? options.bytes.byteLength),
    durationMs: "30000",
    sampleRateHz: "48000",
    channels: "2",
  });
  return app.request(`/api/assets?${query}`, {
    method: "POST",
    headers: { "x-operator-secret": options.secret ?? SECRET, "content-type": "application/octet-stream" },
    body: options.bytes.buffer as ArrayBuffer,
  });
};

const audio = (size = 4096) => {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (i * 31) % 256;
  return bytes;
};

describe("asset upload", () => {
  test("registers a track whose hash and size describe the bytes that arrived", async () => {
    const { app } = harness();
    const bytes = audio();

    const track = Track.parse(await (await upload(app, { bytes })).json());

    expect(track.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(track.byteSize).toBe(bytes.byteLength);
    expect(track.url).toBe(`/api/assets/${track.trackId}`);
    expect(track.label).toBe("Melody stem");
  });

  test("serves back exactly what was uploaded", async () => {
    const { app } = harness();
    const bytes = audio();
    const track = Track.parse(await (await upload(app, { bytes })).json());

    const response = await app.request(track.url);
    const served = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(served).toEqual(bytes);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  test("refuses an upload that ended early instead of registering a hash nobody can match", async () => {
    const { app, assets } = harness();
    const bytes = audio(1000);

    const response = await upload(app, { bytes, declaredSize: 5000 });

    expect(response.status).toBe(400);
    expect(ApiError.parse(await response.json()).error).toMatchObject({ code: "TRUNCATED_UPLOAD", retryable: true });
    // The partial bytes are not left behind pretending to be an asset.
    expect(await readdir(assetDirectory).catch(() => [])).toEqual([]);
    expect(await assets.exists("anything")).toBe(false);
  });

  test("a retried upload returns the original track rather than storing a second copy", async () => {
    const { app } = harness();
    const bytes = audio();

    const first = Track.parse(await (await upload(app, { bytes, commandId: "asset-1" })).json());
    const retry = Track.parse(await (await upload(app, { bytes, commandId: "asset-1" })).json());

    expect(retry).toEqual(first);
    expect(await readdir(assetDirectory)).toHaveLength(1);
  });

  test("a second upload never overwrites an existing track", async () => {
    const { app } = harness();
    const first = Track.parse(await (await upload(app, { bytes: audio(), commandId: "asset-1" })).json());
    const second = Track.parse(await (await upload(app, { bytes: audio(2048), commandId: "asset-2" })).json());

    expect(second.trackId).not.toBe(first.trackId);
    expect((await app.request(first.url)).status).toBe(200);
    expect((await app.request(second.url)).status).toBe(200);
  });

  test("requires the operator secret", async () => {
    const { app } = harness();
    expect((await upload(app, { bytes: audio(), secret: "wrong" })).status).toBe(401);
  });

  test("rejects metadata that is missing or nonsense", async () => {
    const { app } = harness();
    const response = await app.request("/api/assets?commandId=asset-1&label=x&byteSize=-5&durationMs=1&sampleRateHz=1&channels=2", {
      method: "POST", headers: { "x-operator-secret": SECRET }, body: audio(16).buffer as ArrayBuffer,
    });
    expect(response.status).toBe(400);
  });
});

describe("asset paths are never built from client input", () => {
  test("an id containing traversal or separators resolves to nothing", () => {
    const store = new AssetStore(assetDirectory);
    for (const hostile of ["../../etc/passwd", "a/b", "..", "", "a".repeat(65), "x\u0000y", "$(whoami)"]) {
      expect(store.path(hostile)).toBeNull();
    }
  });

  test("a traversal attempt over HTTP is a 404, not a file read", async () => {
    const { app } = harness();
    const response = await app.request("/api/assets/..%2F..%2Fetc%2Fpasswd");
    expect(response.status).toBe(404);
  });

  test("an unknown but well-formed id is a 404", async () => {
    const { app } = harness();
    const response = await app.request("/api/assets/0191d4aa-0000-7000-8000-000000000000");
    expect(response.status).toBe(404);
    expect(ApiError.parse(await response.json()).error.code).toBe("UNKNOWN_ASSET");
  });
});
