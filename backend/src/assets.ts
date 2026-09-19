import { createHash } from "node:crypto";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export const assetsPath = () => process.env.ASSETS_PATH ?? "runtime/assets";

// IDs are server-assigned, but the id in a GET comes from the network, so no path is ever built
// from client input without passing this first.
const SAFE_ID = /^[a-zA-Z0-9-]{1,64}$/;

export class AssetStore {
  constructor(private readonly directory: string) {}

  path(assetId: string): string | null {
    return SAFE_ID.test(assetId) ? join(this.directory, assetId) : null;
  }

  /**
   * Streams the body to disk and hashes it in the same pass, so a file never exists in memory in
   * one piece. The bytes land under a temporary name and are renamed only once the stream ends,
   * so an interrupted upload cannot be mistaken for a complete asset.
   */
  async write(assetId: string, body: ReadableStream<Uint8Array>): Promise<{ sha256: string; byteSize: number }> {
    const target = this.path(assetId);
    if (!target) throw new Error(`Unsafe asset id: ${assetId}`);
    await mkdir(this.directory, { recursive: true });

    const temporary = `${target}.partial`;
    const hash = createHash("sha256");
    const sink = Bun.file(temporary).writer();
    let byteSize = 0;
    try {
      for await (const chunk of body) {
        hash.update(chunk);
        byteSize += chunk.byteLength;
        sink.write(chunk);
      }
      await sink.end();
    } catch (cause) {
      try {
        await sink.end();
      } catch {
        // The sink is already broken; the partial file is removed either way.
      }
      await unlink(temporary).catch(() => {});
      throw cause;
    }

    await rename(temporary, target);
    return { sha256: hash.digest("hex"), byteSize };
  }

  async exists(assetId: string): Promise<boolean> {
    const target = this.path(assetId);
    if (!target) return false;
    return stat(target).then(() => true, () => false);
  }

  async discard(assetId: string): Promise<void> {
    const target = this.path(assetId);
    if (target) await unlink(target).catch(() => {});
  }
}
