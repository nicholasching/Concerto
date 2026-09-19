import { describe, expect, test } from "bun:test";
import { ClientMessage, PROTOCOL_VERSION } from "@orchestra/contracts";
import { ClockEstimator, PROBE_CONSTANTS } from "@orchestra/sync";
import type { ServerClock } from "../src/clock";
import { handleClientMessage } from "../src/messages";
import { SessionState } from "../src/state";

const SESSION = "session-under-test";
const SERVER_SKEW_MS = 4_000_000;
const RESIDENCE_MS = 2;

const probeMessage = (data: { probeGroupId: number; probeGroupIndex: 0 | 1; t0: number; sessionId?: string; serverEpoch?: string }) =>
  JSON.stringify(
    ClientMessage.parse({
      protocolVersion: PROTOCOL_VERSION,
      sessionId: data.sessionId ?? SESSION,
      serverEpoch: data.serverEpoch ?? "epoch-a",
      messageId: `probe-${data.probeGroupId}-${data.probeGroupIndex}`,
      type: "clock.probe",
      payload: { probeGroupId: data.probeGroupId, probeGroupIndex: data.probeGroupIndex, t0: data.t0 },
    }),
  );

const boundTo = (deviceId: number) => {
  const state = new SessionState();
  state.register(deviceId);
  return { deviceId, state };
};

// The handler takes the receipt timestamp and the clock as inputs, so a test can place the
// server anywhere in time without touching the real wall clock.
const serverAt = (serverMs: number): ServerClock => ({
  sessionId: SESSION,
  serverEpoch: "epoch-a",
  nowServerMs: () => serverMs + RESIDENCE_MS,
});

describe("clock.probe handling", () => {
  test("replies with the echoed probe group and the server's own timestamps", () => {
    const reply = handleClientMessage({
      raw: probeMessage({ probeGroupId: 7, probeGroupIndex: 1, t0: 1000 }),
      receivedServerMs: 5000,
      clock: serverAt(5000),
      ...boundTo(0),
    });

    expect(reply.type).toBe("clock.reply");
    if (reply.type !== "clock.reply") throw new Error("expected a clock.reply");
    expect(reply.payload).toEqual({ probeGroupId: 7, probeGroupIndex: 1, t0: 1000, t1: 5000, t2: 5002 });
    expect(reply.payload.t2).toBeGreaterThanOrEqual(reply.payload.t1);
    expect(reply.sessionId).toBe(SESSION);
    expect(reply.serverEpoch).toBe("epoch-a");
  });

  test("answers a probe carrying a stale epoch so the client can discover the current one", () => {
    const reply = handleClientMessage({
      raw: probeMessage({ probeGroupId: 1, probeGroupIndex: 0, t0: 1000, serverEpoch: "epoch-from-previous-run" }),
      receivedServerMs: 5000,
      clock: serverAt(5000),
      ...boundTo(0),
    });

    expect(reply.type).toBe("clock.reply");
    expect(reply.serverEpoch).toBe("epoch-a");
  });

  test("rejects a probe addressed to a different session", () => {
    const reply = handleClientMessage({
      raw: probeMessage({ probeGroupId: 1, probeGroupIndex: 0, t0: 1000, sessionId: "another-session" }),
      receivedServerMs: 5000,
      clock: serverAt(5000),
      ...boundTo(0),
    });

    expect(reply.type).toBe("error");
    if (reply.type !== "error") throw new Error("expected an error");
    expect(reply.payload.error.code).toBe("WRONG_SESSION");
  });

  test("rejects malformed input without throwing", () => {
    const codes = ["not json at all", JSON.stringify({ type: "clock.probe" }), JSON.stringify({ hello: "world" })].map(
      raw => {
        const reply = handleClientMessage({ raw, receivedServerMs: 5000, clock: serverAt(5000), ...boundTo(0) });
        if (reply.type !== "error") throw new Error("expected an error");
        return reply.payload.error.code;
      },
    );
    expect(codes).toEqual(["INVALID_JSON", "INVALID_MESSAGE", "INVALID_MESSAGE"]);
  });

  test("names the owner for a message type this slice does not serve yet", () => {
    const raw = JSON.stringify(
      ClientMessage.parse({
        protocolVersion: PROTOCOL_VERSION,
        sessionId: SESSION,
        serverEpoch: "epoch-a",
        messageId: "assets-1",
        type: "assets.ready",
        payload: { preparationId: "prep-1", ready: true, reason: null, showRevision: 0, trackHashes: {} },
      }),
    );
    const reply = handleClientMessage({ raw, receivedServerMs: 5000, clock: serverAt(5000), ...boundTo(0) });

    if (reply.type !== "error") throw new Error("expected an error");
    expect(reply.payload.error).toMatchObject({ code: "NOT_IMPLEMENTED", owner: "sync-control" });
  });
});

describe("two independent clients against the real handler", () => {
  class SimulatedClient {
    localMs = 1_000_000;
    readonly estimator: ClockEstimator;
    constructor(
      readonly upMs: number,
      readonly downMs: number,
    ) {
      this.estimator = new ClockEstimator({ now: () => this.localMs, timeOriginMs: 0, minMeasurements: 4 });
    }

    probe(probeGroupIndex: 0 | 1, probeGroupId: number, extraUpMs = 0) {
      const t0 = this.localMs;
      this.localMs += this.upMs + extraUpMs;
      const receivedServerMs = this.localMs + SERVER_SKEW_MS;
      const reply = handleClientMessage({
        raw: probeMessage({ probeGroupId, probeGroupIndex, t0 }),
        receivedServerMs,
        clock: serverAt(receivedServerMs),
        ...boundTo(0),
      });
      if (reply.type !== "clock.reply") throw new Error("expected a clock.reply");
      this.localMs += RESIDENCE_MS + this.downMs;
      return this.estimator.accept({ serverEpoch: reply.serverEpoch, ...reply.payload });
    }

    pair(extraUpMsOnSecond = 0) {
      const probeGroupId = this.estimator.beginProbeGroup();
      this.probe(0, probeGroupId);
      this.localMs += PROBE_CONSTANTS.PROBE_GAP_MS;
      return this.probe(1, probeGroupId, extraUpMsOnSecond);
    }
  }

  test("both recover the server clock through their own network conditions", () => {
    const near = new SimulatedClient(5, 5);
    const far = new SimulatedClient(40, 40);

    for (let i = 0; i < 4; i++) {
      near.pair();
      far.pair();
    }

    expect(near.estimator.nowServerMs() - near.localMs).toBe(SERVER_SKEW_MS);
    expect(far.estimator.nowServerMs() - far.localMs).toBe(SERVER_SKEW_MS);
    expect(near.estimator.quality()).toMatchObject({ ready: true, uncertaintyMs: 5 });
    // The far client meets the offset but not the 20 ms uncertainty threshold.
    expect(far.estimator.quality()).toMatchObject({ ready: false, uncertaintyMs: 40 });
  });

  test("one client's corrupted pair does not disturb the other", () => {
    const steady = new SimulatedClient(5, 5);
    const disturbed = new SimulatedClient(5, 5);
    for (let i = 0; i < 4; i++) {
      steady.pair();
      disturbed.pair();
    }

    expect(disturbed.pair(PROBE_CONSTANTS.PROBE_GAP_TOLERANCE_MS + 10)).toBeNull();

    expect(disturbed.estimator.stats()).toMatchObject({ pairsPure: 4, pairsImpure: 1 });
    expect(steady.estimator.stats()).toMatchObject({ pairsPure: 4, pairsImpure: 0 });
    expect(steady.estimator.nowServerMs() - steady.localMs).toBe(SERVER_SKEW_MS);
  });
});
