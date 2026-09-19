import { describe, expect, test } from "bun:test";
import { Show } from "@orchestra/contracts";
import { FakeClock } from "@orchestra/testkit";
import showFixture from "../../../fixtures/show.json";
import { AssetError, AudioContextHost, DecodedBudget, decodedBytes, loadTrack, preloadTracks, scheduleClick, serverMsToAudioTime, setPlaybackAudioSession } from "../src";
import { asAudioContext, FakeAudioContext } from "./fake-audio";

const show = Show.parse(showFixture);
const track = show.tracks[0];
const toneBytes = async () => await Bun.file(new URL(`../../../fixtures/media/${track.trackId}.wav`, import.meta.url)).arrayBuffer();
const serve = (bytes: ArrayBuffer) => async () => new Response(bytes.slice(0));

describe("timing", () => {
  test("uses getOutputTimestamp, applies clock offset sign and converts ms to seconds", () => {
    const ctx = new FakeAudioContext();
    ctx.outputTimestamp = { contextTime: 10, performanceTime: 5000 };
    const clock = new FakeClock(100000, 250); // local performance ms = server ms - 250
    // server 105250 -> local 105000 -> 100 s after the timestamp's performanceTime
    expect(serverMsToAudioTime(clock, asAudioContext(ctx), 105250)).toBeCloseTo(10 + 100, 9);
  });

  test("falls back to currentTime when the output timestamp is unavailable", () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 3;
    ctx.outputTimestamp = { contextTime: 0, performanceTime: 0 };
    expect(serverMsToAudioTime(new FakeClock(), asAudioContext(ctx), 2500, 1000)).toBeCloseTo(3 + 1.5, 9);
  });

  test("never subtracts outputLatency on top of the output-clock mapping", () => {
    const ctx = new FakeAudioContext();
    ctx.outputTimestamp = { contextTime: 10, performanceTime: 5000 };
    const before = serverMsToAudioTime(new FakeClock(), asAudioContext(ctx), 6000);
    ctx.outputLatency = 0.2;
    expect(serverMsToAudioTime(new FakeClock(), asAudioContext(ctx), 6000)).toBe(before);
  });
});

describe("context", () => {
  test("reuses one context and resumes only when paused", async () => {
    const fakes: FakeAudioContext[] = [];
    const host = new AudioContextHost(() => { const fake = new FakeAudioContext(); fakes.push(fake); return asAudioContext(fake); });
    await host.unlock();
    await host.unlock();
    expect(host.context()).toBe(host.context());
    expect(fakes).toHaveLength(1);
    expect(fakes[0].resumeCalls).toBe(1);
    expect(host.state).toBe("running");
  });

  test("resumes from the iOS interrupted state and reports state changes", async () => {
    const fake = new FakeAudioContext();
    const host = new AudioContextHost(() => asAudioContext(fake));
    const states: string[] = [];
    host.onStateChange(state => states.push(state));
    await host.unlock();
    fake.setState("interrupted");
    await host.unlock();
    expect(fake.resumeCalls).toBe(2);
    expect(states).toEqual(["running", "interrupted", "running"]);
  });

  test("unlock fails when the context does not reach running", async () => {
    const fake = new FakeAudioContext();
    fake.resume = async () => { fake.resumeCalls += 1; };
    await expect(new AudioContextHost(() => asAudioContext(fake)).unlock()).rejects.toThrow("suspended");
  });

  test("creates a fresh context after dispose", async () => {
    const fakes: FakeAudioContext[] = [];
    const host = new AudioContextHost(() => { const fake = new FakeAudioContext(); fakes.push(fake); return asAudioContext(fake); });
    host.context();
    await host.dispose();
    expect(fakes[0].state).toBe("closed");
    host.context();
    expect(fakes).toHaveLength(2);
  });
});

describe("assets", () => {
  test("loads the real fixture tone after verifying size and hash", async () => {
    const budget = new DecodedBudget();
    const ctx = new FakeAudioContext();
    const loaded = await loadTrack(track, { ctx: asAudioContext(ctx), budget, baseUrl: "http://mock", fetch: serve(await toneBytes()) });
    expect(loaded.sha256).toBe(track.sha256);
    expect(loaded.decodedBytes).toBe(16000 * 8 * 4);
    expect(budget.usedBytes).toBe(loaded.decodedBytes);
  });

  test("rejects a single flipped byte and leaves the budget unchanged", async () => {
    const bytes = await toneBytes();
    new Uint8Array(bytes)[1000] ^= 1;
    const budget = new DecodedBudget();
    const error = await loadTrack(track, { ctx: asAudioContext(new FakeAudioContext()), budget, baseUrl: "http://mock", fetch: serve(bytes) }).catch(e => e);
    expect(error).toBeInstanceOf(AssetError);
    expect(error.code).toBe("hash");
    expect(budget.usedBytes).toBe(0);
  });

  test("rejects a wrong byte size and an HTTP failure", async () => {
    const options = { ctx: asAudioContext(new FakeAudioContext()), budget: new DecodedBudget(), baseUrl: "http://mock" };
    const short = (await toneBytes()).slice(0, 100);
    expect((await loadTrack(track, { ...options, fetch: serve(short) }).catch(e => e)).code).toBe("size");
    expect((await loadTrack(track, { ...options, fetch: async () => new Response("", { status: 404 }) }).catch(e => e)).code).toBe("http");
  });

  test("resolves the track URL against the asset base", async () => {
    let requested = "";
    const bytes = await toneBytes();
    await loadTrack(track, { ctx: asAudioContext(new FakeAudioContext()), budget: new DecodedBudget(), baseUrl: "http://localhost:18081", fetch: async url => { requested = url; return new Response(bytes); } });
    expect(requested).toBe("http://localhost:18081/api/assets/tone-0");
  });
});

describe("decoded budget", () => {
  test("preloads four long stereo buffers with the default phone budget", async () => {
    const ctx = new FakeAudioContext();
    ctx.decoded = { length: 48_000 * 276.8, numberOfChannels: 2, sampleRate: 48_000, duration: 276.8 };
    const tracks = Array.from({ length: 4 }, (_, index) => ({ ...track, trackId: `long-${index}` }));
    const budget = new DecodedBudget();
    const cache = new Map();
    const failures = await preloadTracks(tracks, { ctx: asAudioContext(ctx), budget, baseUrl: "http://mock", fetch: serve(await toneBytes()) }, cache);
    expect(failures).toEqual([]);
    expect(cache.size).toBe(4);
    expect(budget.usedBytes).toBe(4 * 48_000 * 276.8 * 2 * 4);
  });

  test("keeps the 512 MiB default ceiling and rejects one byte beyond it", () => {
    const budget = new DecodedBudget();
    budget.reserve("full", 512 * 1024 * 1024);
    expect(() => budget.reserve("extra", 1)).toThrow(AssetError);
    expect(budget.usedBytes).toBe(512 * 1024 * 1024);
  });

  test("counts float32 samples per channel", () => {
    expect(decodedBytes({ length: 48000 * 60, numberOfChannels: 1 })).toBe(11520000);
    expect(decodedBytes({ length: 10, numberOfChannels: 2 })).toBe(80);
  });

  test("rejects a load over the limit and replaces a re-reserved track", () => {
    const budget = new DecodedBudget(100);
    budget.reserve("a", 60);
    expect(() => budget.reserve("b", 50)).toThrow(AssetError);
    budget.reserve("a", 90);
    expect(budget.usedBytes).toBe(90);
    budget.release("a");
    budget.reserve("b", 100);
    expect(budget.usedBytes).toBe(100);
  });

  test("an over-budget decode is not reported as loaded", async () => {
    const budget = new DecodedBudget(1000);
    const error = await loadTrack(track, { ctx: asAudioContext(new FakeAudioContext()), budget, baseUrl: "http://mock", fetch: serve(await toneBytes()) }).catch(e => e);
    expect(error.code).toBe("budget");
    expect(budget.usedBytes).toBe(0);
  });
});

describe("schedule", () => {
  const setup = () => {
    const ctx = new FakeAudioContext();
    ctx.state = "running";
    ctx.currentTime = 10;
    ctx.outputTimestamp = { contextTime: 10, performanceTime: 100000 };
    return { ctx, clock: new FakeClock(100000, 0), buffer: {} as AudioBuffer, output: {} as AudioNode };
  };

  test("starts a future click at the mapped audio time", () => {
    const { ctx, clock, buffer, output } = setup();
    const result = scheduleClick(asAudioContext(ctx), output, buffer, clock, 103000);
    expect(result.status).toBe("scheduled");
    expect(ctx.sources[0].started).toEqual([13]);
    expect(ctx.sources[0].connected).toBe(true);
  });

  test("refuses a start that is already in the past", () => {
    const { ctx, clock, buffer, output } = setup();
    const result = scheduleClick(asAudioContext(ctx), output, buffer, clock, 99000);
    expect(result).toEqual({ status: "late", lateBySeconds: 1 });
    expect(ctx.sources).toHaveLength(0);
  });

  test("cancel stops and disconnects the pending source once", () => {
    const { ctx, clock, buffer, output } = setup();
    const result = scheduleClick(asAudioContext(ctx), output, buffer, clock, 103000);
    if (result.status !== "scheduled") throw new Error("expected scheduled");
    result.cancel();
    result.cancel();
    expect(ctx.sources[0].stopped).toBe(1);
    expect(ctx.sources[0].connected).toBe(false);
  });
});

describe("preload", () => {
  test("loads every track, keeps verified ones and reports failures separately", async () => {
    const bytes = await toneBytes();
    const broken = { ...show.tracks[1], sha256: "0".repeat(64) };
    const tracks = [track, broken];
    const cache = new Map();
    let fetches = 0;
    const options = { ctx: asAudioContext(new FakeAudioContext()), budget: new DecodedBudget(), baseUrl: "http://mock", fetch: async () => { fetches += 1; return new Response(bytes.slice(0)); } };
    const failures = await preloadTracks(tracks, options, cache);
    expect([...cache.keys()]).toEqual([track.trackId]);
    expect(failures).toHaveLength(1);
    expect(failures[0].trackId).toBe(broken.trackId);
    await preloadTracks([track], options, cache);
    expect(fetches).toBe(2);
  });
});

describe("iOS audio session", () => {
  test("switches the session to playback when the API exists", () => {
    const nav = { audioSession: { type: "auto" } };
    expect(setPlaybackAudioSession(nav)).toBe(true);
    expect(nav.audioSession.type).toBe("playback");
  });

  test("does nothing where the API is missing", () => {
    expect(setPlaybackAudioSession({})).toBe(false);
    expect(setPlaybackAudioSession(undefined)).toBe(false);
  });
});
