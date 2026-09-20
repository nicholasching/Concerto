import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { getCloneableBody } from "next/dist/server/body-streams";
import audienceConfig from "../next.config";
import adminConfig from "../../admin-frontend/next.config";

// Exercise Next's real body cloning with both deployed proxy configurations.
// This is the encoded size of the percussion upload that was truncated.
for (const [name, config] of [["audience", audienceConfig], ["admin", adminConfig]] as const) {
  test(`${name} proxy preserves an audio upload larger than 10 MiB`, async () => {
    const payload = Buffer.alloc(11_021_760, 0x5a);
    const request = new IncomingMessage(new Socket());
    const configuredLimit = config.experimental?.proxyClientMaxBodySize;
    const body = getCloneableBody(request, typeof configuredLimit === "number" ? configuredLimit : undefined);
    const forwarded = body.cloneBodyStream();
    for (let offset = 0; offset < payload.length; offset += 65536) request.push(payload.subarray(offset, offset + 65536));
    request.push(null);
    let byteSize = 0;
    const hash = createHash("sha256");
    for await (const chunk of forwarded) { byteSize += chunk.length; hash.update(chunk); }
    expect(byteSize).toBe(payload.length);
    expect(hash.digest("hex")).toBe(createHash("sha256").update(payload).digest("hex"));
    request.destroy();
  });
}
