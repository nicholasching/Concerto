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
  private latest: CheckpointData | null = null;
  private batch: { promise: Promise<void>; resolve: () => void; reject: (cause: unknown) => void } | null = null;

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

  /**
   * Serialized, atomic and coalesced. A join wave asks for a save per device, and writing the whole
   * registry once per join is quadratic: 1,500 joins rewrote a growing file 1,500 times and stalled
   * the event loop. Callers arriving while a write is merely queued share that write.
   *
   * The batch closes before the write begins, so a save recorded during a write waits for the next
   * one. A caller is never told its data is durable because someone else's write finished.
   */
  save(data: CheckpointData): Promise<void> {
    this.latest = data;
    if (this.batch) return this.batch.promise;

    let resolve!: () => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<void>((resolveFn, rejectFn) => {
      resolve = resolveFn;
      reject = rejectFn;
    });
    this.batch = { promise, resolve, reject };

    this.queue = this.queue.catch(() => {}).then(async () => {
      const batch = this.batch;
      const payload = this.latest;
      this.batch = null;
      if (!batch || !payload) return;
      try {
        await this.write(payload);
        batch.resolve();
      } catch (cause) {
        batch.reject(cause);
      }
    });
    return promise;
  }

  private async write(data: CheckpointData): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(temporary, JSON.stringify(CheckpointFile.parse(data)), "utf8");
    await rename(temporary, this.path);
  }
}
