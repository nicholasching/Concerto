// Review-only deterministic hook harness. No application code is replaced on disk.
// Reproduce with: bun .devcontext/evidence/admin-console/review-ui-probes.ts
import { mock } from "bun:test";
import { strict as assert } from "node:assert";
import { createDemoSnapshot } from "../../../packages/testkit/src/index";

let state: unknown[] = [];
let cursor = 0;
const calls: { kind: string; args: any }[] = [];
const jsx = (type: unknown, props: unknown) => ({ type, props });
mock.module("react/jsx-dev-runtime", () => ({ jsxDEV: jsx, Fragment: Symbol.for("react.fragment") }));
mock.module("react/jsx-runtime", () => ({ jsx, jsxs: jsx, Fragment: Symbol.for("react.fragment") }));
mock.module("react", () => ({
  useState(initial: unknown) {
    const i = cursor++;
    if (!(i in state)) state[i] = initial;
    return [state[i], (next: any) => { state[i] = typeof next === "function" ? next(state[i]) : next; }];
  },
  useRef(initial: unknown) { return { current: initial }; },
  useEffect() {},
}));
mock.module("../../../admin-frontend/src/lib/useSnapshot", () => ({
  useAdapter: () => ({
    async sendAssignment(args: unknown) { calls.push({ kind: "assignment", args }); return { commandId: "cmd-review" }; },
    async sendTransport(args: unknown) { calls.push({ kind: "transport", args }); },
    async sendMix(args: unknown) { calls.push({ kind: "mix", args }); },
  }),
}));
const { MapPanel } = await import("../../../admin-frontend/src/components/MapPanel");
const { AssignPanel } = await import("../../../admin-frontend/src/components/AssignPanel");
const { PerformPanel } = await import("../../../admin-frontend/src/components/PerformPanel");
function render(component: any, props: any) { cursor = 0; return component(props); }
function allNodes(tree: any): any[] {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(allNodes);
  return [tree, ...allNodes(tree.props?.children)];
}
function node(tree: any, type: any, label?: string) {
  const found = allNodes(tree).find(n => n.type === type && (!label || JSON.stringify(n.props.children).includes(label)));
  assert.ok(found, `missing ${label ?? String(type)}`); return found;
}
function reset() { state = []; cursor = 0; calls.length = 0; }

// The rendered dot at (106,61) represents normalized location (.1,.1).
reset();
const snapshot = createDemoSnapshot(3);
snapshot.audienceMap.locations = [{ deviceId: 0, column: "left", sourceCameraIds: ["cam"], decodeScore: 1, mappingResidualPx: 0, status: "localized", x: .1, y: .1, mappingMode: "manual-anchors" }];
let selected: number[] = [];
const mapProps = { map: snapshot.audienceMap, assignments: snapshot.assignments, channels: snapshot.show.channels, drawable: true, onSelection: (ids: number[]) => { selected = ids; } };
const mouse = (clientX: number, clientY: number) => ({ clientX, clientY, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 360 }) } });
let tree = render(MapPanel, mapProps);
node(tree, "canvas").props.onMouseDown(mouse(102, 57));
tree = render(MapPanel, mapProps);
node(tree, "canvas").props.onMouseMove(mouse(110, 65));
tree = render(MapPanel, mapProps);
node(tree, "canvas").props.onMouseUp();
assert.deepEqual(selected, []);
console.log("REPRODUCED: 8px box enclosing the visible device-0 dot selects zero devices.");

reset();
snapshot.audienceMap.mapRevision = 1;
snapshot.assignments[0].channelId = "channel-a";
snapshot.assignments[1].channelId = "channel-b";
const assignProps = { snapshot, refresh() {} };
tree = render(AssignPanel, assignProps);
node(tree, MapPanel).props.onSelection([0, 1]);
const nextSnapshot = structuredClone(snapshot);
nextSnapshot.audienceMap.mapRevision = 2;
nextSnapshot.audienceMap.locations[0] = { ...nextSnapshot.audienceMap.locations[0], x: .9, y: .9 } as any;
tree = render(AssignPanel, { ...assignProps, snapshot: nextSnapshot });
await node(tree, "button", "Assign ").props.onClick();
assert.equal(calls[0].args.mapRevision, 2);
assert.deepEqual(calls[0].args.deviceIds, [0, 1]);
console.log("REPRODUCED: IDs selected at map revision 1 are submitted with revision 2 after map replacement.");
tree = render(AssignPanel, { ...assignProps, snapshot: nextSnapshot });
await node(tree, "button", "Undo").props.onClick();
assert.deepEqual(calls[1].args.deviceIds, [0, 1]);
assert.equal(calls[1].args.channelId, "channel-a");
console.log("REPRODUCED: Undo restores both mixed-channel devices to first device's channel-a; device 1 loses channel-b.");

reset();
snapshot.serverMs = 100000;
tree = render(PerformPanel, { snapshot, refresh() {} });
await node(tree, "button", "Play").props.onClick();
assert.equal(calls[0].args.effectiveServerMs, 100000);
const gainInput = allNodes(tree).find(n => n.type === "input" && n.props.type === "range");
await gainInput.props.onChange({ target: { value: "0.5" } });
assert.equal(calls[1].args.effectiveServerMs, 100000);
console.log("REPRODUCED: Play and gain commands use snapshot timestamp 100000 with zero lead time, already past once received.");

// These assertions intentionally confirm observed defects, not acceptance.
console.log("Four UI regressions reproduced against unchanged HEAD components. This is not browser or physical evidence.");
