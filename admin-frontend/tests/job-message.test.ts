import { expect, test } from "bun:test";
import { jobMessage } from "../src/lib/job-message";

test("a failed camera job shows the actual worker error as well as its exit status", () => {
  const reason = "Camera camera-center: ValueError: Too many screen tracks; inspect exclusions or camera motion";
  expect(jobMessage({ stage: "failed", message: "worker exited with code 2" }, ["codec warning", JSON.stringify({ error: reason })]))
    .toBe(`${reason} (worker exited with code 2)`);
});

test("unstructured diagnostics retain the failure message and cannot break progress rendering", () => {
  expect(jobMessage({ stage: "failed", message: "worker stopped" }, ["Traceback", "null", '{"error":42}'])).toBe("worker stopped");
  expect(jobMessage({ stage: "track", message: "Reading frames" }, ['{"error":"old warning"}'])).toBe("Reading frames");
});
