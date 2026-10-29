/** Rate-limit delivery without inventing a long idle gap when an HTTP proxy coalesces chunks. */
export function pacedBody(body: ReadableStream<Uint8Array>, options: {
  onBytes: (bytes: number) => void; onEnd: () => void;
  wait?: (ms: number) => Promise<void>; chunkBytes?: number; bytesPerSecond?: number;
}): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let buffered: Uint8Array | null = null, offset = 0, ended = false;
  const end = () => { if (!ended) { ended = true; options.onEnd(); } };
  return new ReadableStream({
    async pull(controller) {
      try {
        while (!buffered || offset === buffered.length) {
          const next = await reader.read();
          if (next.done) { end(); controller.close(); return; }
          buffered = next.value; offset = 0;
        }
        const part = buffered.subarray(offset, offset + (options.chunkBytes ?? 32768));
        offset += part.length;
        await (options.wait ?? Bun.sleep)(part.length / (options.bytesPerSecond ?? 32768) * 1000);
        if (ended) return;
        options.onBytes(part.length); controller.enqueue(part);
      } catch (error) { end(); controller.error(error); }
    },
    async cancel() { end(); await reader.cancel(); },
  });
}
