import { expect, test } from "bun:test";
import { joinSession, tokenKey, type KeyValueStore } from "../src/lib/join";

const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);
const joined = (deviceId: number, resumeToken: string, sessionId = "demo") =>
  Response.json({ protocolVersion: 1, sessionId, serverEpoch: "epoch-1", deviceId, resumeToken, revision: 1 });
const apiError = (status: number, code: string) =>
  Response.json({ protocolVersion: 1, error: { code, message: code, retryable: false } }, { status });

function memory(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); } };
}

function recorder(responses: Response[]) {
  const bodies: unknown[] = [];
  const fetch = async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return responses.shift()!; };
  return { fetch, bodies };
}

test("a first join sends no token, stores the new one and accepts device 0", async () => {
  const storage = memory();
  const { fetch, bodies } = recorder([joined(0, TOKEN_A)]);
  const result = await joinSession({ api: "http://mock", sessionId: "demo", storage, fetch });
  expect(bodies).toEqual([{}]);
  expect(result).toMatchObject({ status: "joined", newDevice: true, tokenRejected: false, join: { deviceId: 0 } });
  expect(storage.data.get(tokenKey("demo"))).toBe(TOKEN_A);
});

test("a reload resumes with the saved token and keeps the device ID", async () => {
  const storage = memory({ [tokenKey("demo")]: TOKEN_A });
  const { fetch, bodies } = recorder([joined(7, TOKEN_A)]);
  const result = await joinSession({ api: "http://mock", sessionId: "demo", storage, fetch });
  expect(bodies).toEqual([{ resumeToken: TOKEN_A }]);
  expect(result).toMatchObject({ status: "joined", newDevice: false, join: { deviceId: 7 } });
});

test("a rejected token is dropped and the phone joins as a new device", async () => {
  const storage = memory({ [tokenKey("demo")]: TOKEN_A });
  const { fetch, bodies } = recorder([apiError(401, "INVALID_RESUME_TOKEN"), joined(3, TOKEN_B)]);
  const result = await joinSession({ api: "http://mock", sessionId: "demo", storage, fetch });
  expect(bodies).toEqual([{ resumeToken: TOKEN_A }, {}]);
  expect(result).toMatchObject({ status: "joined", newDevice: true, tokenRejected: true, join: { deviceId: 3 } });
  expect(storage.data.get(tokenKey("demo"))).toBe(TOKEN_B);
});

test("a full session is reported once, not retried", async () => {
  const { fetch, bodies } = recorder([apiError(409, "SESSION_FULL")]);
  expect(await joinSession({ api: "http://mock", sessionId: "demo", storage: memory(), fetch })).toEqual({ status: "full" });
  expect(bodies).toHaveLength(1);
});

test("the production server capacity error also stops retries", async () => {
  const { fetch } = recorder([apiError(503, "CAPACITY_REACHED")]);
  expect(await joinSession({ api: "http://mock", sessionId: "demo", storage: memory(), fetch })).toEqual({ status: "full" });
});

test("invalid responses, wrong sessions and network errors are errors, not identities", async () => {
  const storage = memory();
  const bad = await joinSession({ api: "http://mock", sessionId: "demo", storage, fetch: async () => Response.json({ deviceId: 5 }) });
  expect(bad.status).toBe("error");
  const other = await joinSession({ api: "http://mock", sessionId: "demo", storage, fetch: async () => joined(1, TOKEN_A, "other") });
  expect(other).toMatchObject({ status: "error", message: expect.stringContaining("other") });
  const down = await joinSession({ api: "http://mock", sessionId: "demo", storage, fetch: async () => { throw new Error("offline"); } });
  expect(down).toEqual({ status: "error", message: "offline" });
  const server = await joinSession({ api: "http://mock", sessionId: "demo", storage, fetch: async () => apiError(500, "BOOM") });
  expect(server).toEqual({ status: "error", message: "BOOM: BOOM" });
  expect(storage.data.size).toBe(0);
});

test("concurrent joins for one session share a single request", async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; await Bun.sleep(5); return joined(0, TOKEN_A); };
  const options = { api: "http://mock", sessionId: "demo", storage: memory(), fetch };
  const [first, second] = await Promise.all([joinSession(options), joinSession(options)]);
  expect(calls).toBe(1);
  expect(first).toEqual(second);
});

test("storage that throws does not break joining", async () => {
  const broken: KeyValueStore = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
  const result = await joinSession({ api: "http://mock", sessionId: "demo", storage: broken, fetch: async () => joined(2, TOKEN_A) });
  expect(result).toMatchObject({ status: "joined", join: { deviceId: 2 } });
});
