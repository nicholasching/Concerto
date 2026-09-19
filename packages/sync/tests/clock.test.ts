import { expect, spyOn, test } from "bun:test";
import { epochNow } from "../src";

test("epoch clock does not follow a wall-clock jump", () => {
  const before = epochNow();
  const wall = spyOn(Date, "now").mockReturnValue(1);
  try { const after = epochNow(); expect(after).toBeGreaterThanOrEqual(before); expect(after - before).toBeLessThan(1000); }
  finally { wall.mockRestore(); }
});
