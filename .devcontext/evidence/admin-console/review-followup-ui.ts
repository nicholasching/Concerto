// Review-only handler verification for 909e42a. Hook doubles are not browser evidence.
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { createDemoSnapshot } from "../../../packages/testkit/src/index";
import { createAdapter } from "../../../admin-frontend/src/lib/adapter";
import { CommandAccepted } from "../../../packages/contracts/src/index";
import { syncFromServerMs, nowServerMs } from "../../../admin-frontend/src/lib/clock";

let state: any[] = [], cursor = 0;
const calls: { kind: string; args: any }[] = [], results: unknown[] = [];
const jsx = (type: unknown, props: unknown) => ({ type, props });
mock.module("react/jsx-dev-runtime", () => ({ jsxDEV: jsx, Fragment: Symbol.for("react.fragment") }));
mock.module("react/jsx-runtime", () => ({ jsx, jsxs: jsx, Fragment: Symbol.for("react.fragment") }));
mock.module("react", () => ({
  useState(initial: any) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value: any) => { state[i] = typeof value === "function" ? value(state[i]) : value; }]; },
  useRef(initial: any) { return { current: initial }; }, useEffect() {},
}));
const captureAdapter = {
  async sendAssignment(args: any) { calls.push({ kind: "assignment", args }); return { commandId: "cmd-review" }; },
  async sendTransport(args: any) { calls.push({ kind: "transport", args }); },
  async sendMix(args: any) { calls.push({ kind: "mix", args }); },
  async createCalibration(ids: number[]) { calls.push({ kind: "calibration", args: ids }); return { runId: "run", runTag: 1 }; },
  pending() { return []; },
};
let activeAdapter: any = captureAdapter;
let viewState: any;
mock.module("../../../admin-frontend/src/lib/useSnapshot", () => ({ useAdapter: () => activeAdapter, useSnapshot: () => viewState }));
const { MapPanel } = await import("../../../admin-frontend/src/components/MapPanel");
const { AssignPanel } = await import("../../../admin-frontend/src/components/AssignPanel");
const { PerformPanel } = await import("../../../admin-frontend/src/components/PerformPanel");
const { CalibrationPanel } = await import("../../../admin-frontend/src/components/CalibrationPanel");
const { default: Page } = await import("../../../admin-frontend/src/app/page");
function render(component: any, props: any = {}) { cursor = 0; return component(props); }
function nodes(tree: any): any[] { if (!tree || typeof tree !== "object") return []; if (Array.isArray(tree)) return tree.flatMap(nodes); return [tree, ...nodes(tree.props?.children)]; }
function node(tree: any, type: any, label?: string) { const found = nodes(tree).find(n => n.type === type && (!label || JSON.stringify(n.props.children)?.includes(label))); assert.ok(found, label ?? String(type)); return found; }
function reset() { state = []; cursor = 0; calls.length = 0; activeAdapter = captureAdapter; }

const snapshot = createDemoSnapshot(3);
snapshot.audienceMap.locations = [{ deviceId: 0, column: "left", sourceCameraIds: ["cam"], decodeScore: 1, mappingResidualPx: 0, status: "localized", x: .1, y: .1, mappingMode: "manual-anchors" }];
for (const scale of [1, .5]) {
  reset();
  let selected: any;
  const props = { map: snapshot.audienceMap, assignments: snapshot.assignments, channels: snapshot.show.channels, drawable: true, onSelection: (s: any) => { selected = s; } };
  const mouse = (x: number, y: number) => ({ clientX: x * scale, clientY: y * scale, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 900 * scale, height: 360 * scale }) } });
  let tree = render(MapPanel, props); node(tree, "canvas").props.onMouseDown(mouse(102, 57));
  tree = render(MapPanel, props); node(tree, "canvas").props.onMouseMove(mouse(110, 65));
  tree = render(MapPanel, props); node(tree, "canvas").props.onMouseUp();
  assert.deepEqual(selected.deviceIds, [0]);
  assert.equal(selected.mapRevision, snapshot.audienceMap.mapRevision);
}
results.push({ issue: "R4", result: "fixed", evidence: "Actual drag handlers select visible device 0 at full and half CSS scale." });

reset(); snapshot.audienceMap.mapRevision = 1;
let tree = render(AssignPanel, { snapshot, refresh() {} });
node(tree, MapPanel).props.onSelection({ mapRevision: 1, deviceIds: [0, 1] });
const changed = structuredClone(snapshot); changed.audienceMap.mapRevision = 2;
tree = render(AssignPanel, { snapshot: changed, refresh() {} });
await node(tree, "button", "Assign ").props.onClick();
assert.equal(calls[0].args.mapRevision, 1);
results.push({ issue: "R3", result: "fixed captured revision", evidence: "Selection from map 1 remains map 1 after snapshot map becomes 2." });

reset(); syncFromServerMs(100000);
tree = render(PerformPanel, { snapshot, refresh() {} });
const before = nowServerMs(); await node(tree, "button", "Play").props.onClick();
assert.ok(calls[0].args.effectiveServerMs >= before + 3000);
await nodes(tree).find(n => n.type === "input" && n.props.type === "range").props.onChange({ target: { value: "0.5" } });
assert.ok(calls[1].args.effectiveServerMs >= before + 3000);
results.push({ issue: "R1", result: "fixed zero-lead subcase", evidence: "Play and mix use at least 3000ms relative to interim clock; shared clock/preparation remain absent." });

reset();
const live = createDemoSnapshot(3);
live.devices = live.devices.map((d, i) => ({ ...d, deviceId: [7, 42, 100][i], connected: i !== 2, foreground: true, clockReady: true, audioUnlocked: true }));
tree = render(CalibrationPanel, { snapshot: live, refresh() {} });
await node(tree, "button", "Start calibration").props.onClick();
assert.deepEqual(calls[0].args, [7, 42]);
results.push({ issue: "R5", result: "fixed fixture-ID subcase", evidence: "Live non-contiguous eligible IDs 7 and 42 are submitted; disconnected ID 100 is excluded." });

reset();
viewState = { snapshot, error: "offline", loading: false, refresh() {} };
tree = render(Page);
assert.ok(nodes(tree).some(n => n.props?.role === "alert"));
results.push({ issue: "R14", result: "fixed banner subcase", evidence: "Disconnect alert renders alongside retained snapshot; mutation controls remain enabled." });

// Exercise grouped Undo with the real adapter and revision-validating injected responses.
reset();
let server = createDemoSnapshot(3); server.revision = 100;
const [a, b, c] = server.show.channels.map(ch => ch.channelId);
server.assignments[0].channelId = a; server.assignments[1].channelId = b;
let holdGets = false;
const delayedGets: ((r: Response) => void)[] = [];
const posts: { revision: number; channel: string; ids: number[]; accepted: boolean }[] = [];
activeAdapter = createAdapter("http://review.invalid", (_url, init) => {
  if (init?.method !== "POST") return holdGets ? new Promise(resolve => delayedGets.push(resolve)) : Promise.resolve(Response.json(server));
  const body = JSON.parse(String(init.body));
  const matches = body.expectedRevision === server.revision;
  posts.push({ revision: body.expectedRevision, channel: body.channelId, ids: body.deviceIds, accepted: matches });
  if (!matches) return Promise.resolve(Response.json({ protocolVersion: 1, error: { code: "STALE_REVISION", message: "Expected revision mismatch", retryable: true } }, { status: 409 }));
  server = { ...server, revision: server.revision + 1 };
  return Promise.resolve(Response.json(CommandAccepted.parse({ protocolVersion: 1, sessionId: body.sessionId, serverEpoch: body.serverEpoch, commandId: body.commandId, revision: server.revision })));
});
const initial = await activeAdapter.getSnapshot();
const refresh = () => { void activeAdapter.getSnapshot(); };
tree = render(AssignPanel, { snapshot: initial, refresh });
node(tree, MapPanel).props.onSelection({ mapRevision: initial.audienceMap.mapRevision, deviceIds: [0, 1] });
node(tree, "select").props.onChange({ target: { value: c } });
tree = render(AssignPanel, { snapshot: initial, refresh });
holdGets = true;
await node(tree, "button", "Assign ").props.onClick();
holdGets = false; await activeAdapter.getSnapshot();
server.assignments[0].channelId = c; server.assignments[1].channelId = c;
tree = render(AssignPanel, { snapshot: structuredClone(server), refresh });
holdGets = true;
await node(tree, "button", "Undo").props.onClick();
assert.deepEqual(posts.slice(1).map(p => p.accepted), [true, false]);
assert.deepEqual(posts.slice(1).map(p => p.channel), [a, b]);
tree = render(AssignPanel, { snapshot: server, refresh });
assert.equal(node(tree, "button", "Undo").props.disabled, true);
for (const resolve of delayedGets) resolve(Response.json(server));
results.push({ issue: "R9", result: "partial; still broken", evidence: "Per-channel groups retained, but second Undo POST uses stale expectedRevision; failure then clears Undo history.", posts });
console.log(JSON.stringify({ reviewedHead: "909e42a", category: "deterministic actual component handlers with hook/HTTP doubles", checks: results }, null, 2));
