import { expect, test } from "bun:test";
import { pacedBody } from "../paced-body";

test("a coalesced 1 MiB HTTP chunk becomes 32 progressing one-second deliveries", async () => {
  const bytes = new Uint8Array(1024 * 1024); for (let i=0;i<bytes.length;i++) bytes[i]=i%251;
  const waits:number[] = []; let total=0, ended=0;
  const input = new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes);controller.enqueue(new Uint8Array());controller.close();}});
  const body = pacedBody(input, {onBytes:n => {total+=n;},onEnd:() => {ended++;},wait:async ms => {waits.push(ms);}});
  expect(new Uint8Array(await new Response(body).arrayBuffer())).toEqual(bytes);
  expect(waits).toHaveLength(32); expect(waits.every(ms => ms===1000)).toBe(true);
  expect(total).toBe(bytes.length); expect(ended).toBe(1);
});

test("cancellation stops the underlying reader and finishes accounting once", async () => {
  let cancelled=0,ended=0;
  const input = new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new Uint8Array(65536));},cancel(){cancelled++;}});
  const reader = pacedBody(input,{onBytes:()=>{},onEnd:()=>{ended++;},wait:async()=>{}}).getReader();
  await reader.read(); await reader.cancel(); expect(cancelled).toBe(1); expect(ended).toBe(1);
});
