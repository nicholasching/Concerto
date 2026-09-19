import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { AudienceMap, Show } from "@orchestra/contracts";

export const CheckpointFile = z.strictObject({
  version: z.literal(3),
  sessionId: z.string().min(1),
  nextDeviceId: z.number().int().min(0).max(2048),
  devices: z.array(
    z.strictObject({
      deviceId: z.number().int().min(0).max(2047),
      tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
      joinedServerMs: z.number().nonnegative(),
    }),
  ),
  show: Show.nullable(),
  map: AudienceMap.nullable(),
  committedRunTag: z.number().int().min(0).max(255).nullable(),
});
export type CheckpointData = z.infer<typeof CheckpointFile>;

export const checkpointPath = () => process.env.CHECKPOINT_PATH ?? "runtime/checkpoint.json";

export class CheckpointStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  // A corrupt file throws. Starting with an empty registry would silently hand out device IDs
  // that are already in use by phones holding valid resume tokens.
  async read(): Promise<CheckpointData | null> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw cause;
    }
    try {
      return CheckpointFile.parse(JSON.parse(raw));
    } catch (cause) {
      throw new Error(
        `Checkpoint at ${this.path} is unreadable. If it predates the current build, delete it to start a fresh session.`,
        { cause },
      );
    }
  }

  // Serialized and atomic: a crash leaves either the whole previous file or the whole new one.
  save(data: CheckpointData): Promise<void> {
    const next = this.queue.catch(() => {}).then(() => this.write(data));
    this.queue = next.catch(() => {});
    return next;
  }

  private async write(data: CheckpointData): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporary, JSON.stringify(CheckpointFile.parse(data)), "utf8");
    await rename(temporary, this.path);
  }
}
