import { expect, test } from "bun:test";
import { participantEndpoints } from "../src/lib/endpoints";

test("a public HTTPS audience uses the same origin and secure WebSocket", () => {
  expect(participantEndpoints("https://test-name.trycloudflare.com")).toEqual({
    api: "https://test-name.trycloudflare.com", wsUrl: "wss://test-name.trycloudflare.com/ws",
  });
});
test("local audience traffic also uses its reverse proxy", () => {
  expect(participantEndpoints("http://localhost:3000")).toEqual({ api: "http://localhost:3000", wsUrl: "ws://localhost:3000/ws" });
});
test("explicit mock or deployment endpoints still override the proxy", () => {
  expect(participantEndpoints("http://localhost:3000", { api: "http://localhost:18081/" })).toEqual({ api: "http://localhost:18081", wsUrl: "ws://localhost:18081/ws" });
  expect(participantEndpoints("https://audience.example.com", { api: "https://api.example.com", ws: "wss://sockets.example.com/control" })).toEqual({ api: "https://api.example.com", wsUrl: "wss://sockets.example.com/control" });
});
