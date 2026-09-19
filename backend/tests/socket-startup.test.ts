import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JoinResponse, ServerMessage } from "@orchestra/contracts";

test("real server sends authenticated initial snapshots before any client message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "orchestra-socket-"));
  const child = Bun.spawn([process.execPath, "backend/src/index.ts"], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, PORT: "0", HOST: "127.0.0.1", SESSION_ID: "startup-test", OPERATOR_SECRET: "socket-test-secret",
      CHECKPOINT_PATH: join(directory, "checkpoint.json"), ASSETS_PATH: join(directory, "assets") },
  });
  const sockets: WebSocket[] = [];
  try {
    const reader = child.stdout.getReader();
    let output = "";
    while (!output.includes("Backend:")) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Server exited: ${await new Response(child.stderr).text()}`);
      output += new TextDecoder().decode(chunk.value);
    }
    const url = output.match(/Backend: (http:\/\/\S+)/)![1];
    const identity = JoinResponse.parse(await (await fetch(`${url}api/sessions/startup-test/join`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    })).json());
    for (const [credential, role] of [[`resumeToken=${identity.resumeToken}`, "participant"], ["operatorSecret=socket-test-secret", "admin"]] as const) {
      const socket = new WebSocket(`${url.replace("http:", "ws:")}ws?${credential}`);
      sockets.push(socket);
      const message = await new Promise<unknown>((resolve, reject) => {
        socket.onmessage = event => resolve(JSON.parse(String(event.data)));
        socket.onerror = () => reject(new Error("Socket failed"));
      });
      const parsed = ServerMessage.parse(message);
      expect(parsed.type).toBe("state.snapshot");
      if (parsed.type === "state.snapshot") expect(parsed.payload.role).toBe(role);
    }
  } finally {
    for (const socket of sockets) socket.close();
    child.kill();
    await child.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
