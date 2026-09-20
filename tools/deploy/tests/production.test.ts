import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { productionConfiguration } from "../../../scripts/start-production";

test("production requires a configured operator credential", () => {
  for (const OPERATOR_SECRET of [undefined, "", "local-demo-only"]) {
    expect(() => productionConfiguration({ OPERATOR_SECRET })).toThrow("production OPERATOR_SECRET");
  }
});

test("production isolates durable state from inherited dev paths", () => {
  const data = resolve("runtime/deployment-test");
  const config = productionConfiguration({ OPERATOR_SECRET: "test-only-production", DATA_DIR: data, PORT: "13086",
    BACKEND_INTERNAL_URL: "http://127.0.0.1:18086", ADMIN_INTERNAL_URL: "http://127.0.0.1:13087",
    CHECKPOINT_PATH: "runtime/local/checkpoint.json", ASSETS_PATH: "runtime/local/assets" });
  expect(config.port).toBe(13086);
  expect(config.backendPort).toBe(18086);
  expect(config.adminPort).toBe(13087);
  expect(config.env.CHECKPOINT_PATH).toBe(resolve(data, "checkpoint.json"));
  expect(config.env.ASSETS_PATH).toBe(resolve(data, "assets"));
  expect(config.env.UPLOADS_PATH).toBe(resolve(data, "uploads"));
  expect(config.env.JOBS_PATH).toBe(resolve(data, "jobs"));
  expect(config.env.NODE_ENV).toBe("production");
  expect(config.env.SESSION_ID).toBe("prod-session");
});

test("single-service ports cannot collide or point at another backend", () => {
  for (const settings of [{ PORT: "8080" }, { PORT: "NaN" }, { PORT: "0" }, { PORT: "65536" },
    { BACKEND_INTERNAL_URL: "https://remote.example:8080" }, { ADMIN_INTERNAL_URL: "http://127.0.0.1" }]) {
    expect(() => productionConfiguration({ OPERATOR_SECRET: "test-only-production", ...settings })).toThrow();
  }
});
