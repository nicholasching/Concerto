import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cancelPreloads, DecodedBudget, DOWNLOAD_POLICY, loadTrack, preloadTracks, type LoadTrackOptions } from "../src/assets";

const bytes = new Uint8Array([1,2,3,4,5,6,7,8]);
const track = {trackId:"test", label:"test", url:"/asset", byteSize:8, sha256:createHash("sha256").update(bytes).digest("hex"),
  durationMs:1000, sampleRateHz:48000, channels:1};
const options = (): LoadTrackOptions => ({baseUrl:"http://test", budget:new DecodedBudget(),
  ctx:{decodeAudioData:async () => ({length:8, numberOfChannels:1}) as AudioBuffer}, sleep:async () => {}, random:() => 0});

test("transient failure retries with increasing jittered backoff and bounded Retry-After, then verifies/decode once", async () => {
  let requests = 0, decodes = 0; const waits:number[] = [];
  const config = options(); config.ctx = {decodeAudioData:async () => {decodes++; return {length:8, numberOfChannels:1} as AudioBuffer;}};
  const loaded = await loadTrack(track, {...config, random:() => 0.5, sleep:async ms => {waits.push(ms);},
    fetch:async () => {requests++; return requests === 1 ? new Response(null,{status:503,headers:{"Retry-After":"3600"}})
      : requests === 2 ? new Response(null,{status:429}) : new Response(bytes);}});
  expect(waits).toEqual([61000,5000]); expect(requests).toBe(3); expect(decodes).toBe(1); expect(loaded.sha256).toBe(track.sha256);
});

test("header and body stalls timeout, abort, and stop after four attempts", async () => {
  for (const bodyStall of [false,true]) {
    let requests = 0; const signals:AbortSignal[] = [];
    await expect(loadTrack(track, {...options(), timeoutMs:10, fetch:async (_url, init) => {
      requests++; signals.push(init!.signal as AbortSignal);
      if (!bodyStall) return new Promise<Response>(() => {});
      return new Response(new ReadableStream({start(controller) {controller.enqueue(bytes.slice(0,2));}}));
    }})).rejects.toMatchObject({code:"timeout"});
    expect(requests).toBe(4); expect(signals.every(signal => signal.aborted)).toBe(true);
  }
});

test("progressing transfer may exceed one idle-timeout window", async () => {
  const stream = new ReadableStream<Uint8Array>({start(controller) {
    let offset = 0;
    const next = () => {controller.enqueue(bytes.slice(offset,++offset)); if (offset === bytes.length) controller.close(); else setTimeout(next,30);};
    next();
  }});
  const loaded = await loadTrack(track, {...options(), timeoutMs:150, fetch:async () => new Response(stream)});
  expect(loaded.sha256).toBe(track.sha256);
});

test("a truncated transfer retries, while cancellation during backoff makes no more requests", async () => {
  let requests=0;
  expect((await loadTrack(track, {...options(), fetch:async () => new Response(++requests === 1 ? bytes.slice(0,2) : bytes)})).sha256).toBe(track.sha256);
  expect(requests).toBe(2);
  requests=0; const controller = new AbortController();
  const pending = loadTrack(track, {...options(), sleep:undefined, signal:controller.signal,
    fetch:async () => {requests++; return new Response(null,{status:503});}}).catch(error => error);
  await Bun.sleep(0); controller.abort();
  expect(await pending).toMatchObject({name:"AbortError"});
  expect(requests).toBe(1);
});

test("hash, decode, oversized response, budget and HTTP 404 failures do not retry", async () => {
  for (const failure of ["hash","decode","oversized","budget","404"]) {
    let requests = 0; const config = options();
    if (failure === "budget") config.budget = new DecodedBudget(1);
    if (failure === "decode") config.ctx = {decodeAudioData:async () => {throw new Error("unsupported codec");}};
    await expect(loadTrack({...track, sha256:failure === "hash" ? "0".repeat(64) : track.sha256}, {...config,
      fetch:async () => {requests++; return failure === "404" ? new Response(null,{status:404})
        : new Response(failure === "oversized" ? new Uint8Array(9) : bytes);}})).rejects.toThrow();
    expect(requests).toBe(1);
  }
});

test("two track campaigns at most; overlapping callers share work and verified tracks stay cached", async () => {
  const cache = new Map(); const tracks = Array.from({length:6},(_,i)=>({...track, trackId:`t${i}`}));
  let active=0, maxActive=0, requests=0;
  const config = {...options(), fetch:async () => {requests++; active++; maxActive=Math.max(maxActive,active);
    await Bun.sleep(2); active--; return new Response(bytes);}};
  const first = preloadTracks(tracks, config, cache), second = preloadTracks(tracks, config, cache);
  expect(await first).toEqual([]); expect(await second).toEqual([]);
  expect(maxActive).toBe(2); expect(requests).toBe(6); expect(cache.size).toBe(6);
  await preloadTracks(tracks, config, cache); expect(requests).toBe(6);
});

test("250 phones during outage are capped at 1000 requests; status/gesture repeats cannot start fresh campaigns", async () => {
  let requests=0; const waits:number[] = [];
  await Promise.all(Array.from({length:250}, async (_,i) => {
    const cache = new Map(); const config = {...options(), random:() => i/250, sleep:async (ms:number) => {waits.push(ms);},
      fetch:async () => {requests++; throw new TypeError("network unavailable");}};
    await Promise.all([preloadTracks([track],config,cache),preloadTracks([track],config,cache)]);
    await preloadTracks([track],config,cache); await preloadTracks([track],config,cache);
    expect(cache.size).toBe(0);
  }));
  expect(requests).toBe(250*DOWNLOAD_POLICY.attempts);
  expect(Math.min(...waits)).toBe(2000); expect(Math.max(...waits)).toBeGreaterThan(9000);
  expect(new Set(waits).size).toBeGreaterThan(250);
});

test("unmount and replaced show cancel active and queued tracks without starting retries", async () => {
  for (const replace of [false,true]) {
    const cache = new Map(); const signals:AbortSignal[] = []; let oldRequests=0;
    const config = {...options(), timeoutMs:1000, fetch:async (url:string, init?:RequestInit) => {
      if (url.endsWith("/new")) return new Response(bytes);
      oldRequests++; signals.push(init!.signal as AbortSignal); return new Promise<Response>(() => {});
    }};
    const old = preloadTracks(Array.from({length:5},(_,i)=>({...track, trackId:`old${i}`})),config,cache);
    await Bun.sleep(0);
    if (replace) expect(await preloadTracks([{...track,trackId:"new",url:"/new"}],config,cache)).toEqual([]);
    else cancelPreloads(cache);
    expect(await old).toHaveLength(5);
    expect(oldRequests).toBe(2); expect(signals.every(signal => signal.aborted)).toBe(true);
    expect([...cache.keys()]).toEqual(replace ? ["new"] : []);
  }
});
