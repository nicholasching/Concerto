import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminSnapshot } from "@orchestra/contracts";
import fixture from "../../fixtures/admin-snapshot.json";
import { PerformPanel } from "../src/components/PerformPanel";
import { createAdapter } from "../src/lib/adapter";

test("music controls are usable with no operator clock samples", () => {
  const snapshot = AdminSnapshot.parse(fixture);
  snapshot.preparations = [{domain: "transport", preparationId: "p", showRevision: snapshot.show.showRevision,
    transportRevision: snapshot.transport.transportRevision, expectedIds: [0], readyIds: [0], excluded: []}];
  const html = renderToStaticMarkup(createElement(PerformPanel, { snapshot, refresh: () => {} }));
  expect(html).toContain(">Prepare cue</button>");
  expect(html).not.toContain('disabled="">Prepare cue');
  expect(html).not.toContain('disabled="">▶ Start show');
});

test("transport, mix and assignment intent sends no operator timestamp", async () => {
  const snapshot = AdminSnapshot.parse(fixture);
  const requests: Record<string, unknown>[] = [];
  const adapter = createAdapter("https://test", async (_url, init) => {
    if (!init?.body) return Response.json(snapshot);
    const body = JSON.parse(String(init.body)); requests.push(body);
    return Response.json({protocolVersion:1, sessionId: snapshot.sessionId, serverEpoch: snapshot.serverEpoch,
      commandId: body.commandId, revision: 1, effectiveServerMs: snapshot.serverMs + 5000});
  });
  adapter.configure("test", snapshot.sessionId); await adapter.getSnapshot();
  await adapter.sendTransport({action:"play", showRevision:snapshot.show.showRevision, positionMs:0});
  await adapter.sendMix({masterGain:0.5, channels:snapshot.show.channels});
  await adapter.sendAssignment({deviceIds:[0],channelId:null,mapRevision:snapshot.audienceMap.mapRevision});
  expect(requests).toHaveLength(3);
  expect(requests.every(request => !("effectiveServerMs" in request))).toBe(true);
});
