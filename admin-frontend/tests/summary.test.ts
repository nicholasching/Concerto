import { expect, test } from "bun:test";
import { AdminSnapshot } from "@orchestra/contracts";
import fixture from "../../fixtures/admin-snapshot.json";
import { audienceSummary } from "../src/lib/summary";

test("operator counts preserve distinct readiness and localization states", () => {
  const snapshot = AdminSnapshot.parse(structuredClone(fixture));
  expect(audienceSummary(snapshot)).toEqual({ connected: 30, clockReady: 30, audioUnlocked: 0, localized: 27, unresolved: 3 });
  snapshot.devices[0].connected = false;
  expect(audienceSummary(snapshot).clockReady).toBe(29);
});
