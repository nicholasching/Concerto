import { AUDIO_FILE_CACHE } from "@/demo";
import { corsHeaders, errorResponse } from "@/utils/responses";

export function handleServeAudio(pathname: string): Response {
  const filename = decodeURIComponent(pathname.slice("/audio/".length));

  const cached = AUDIO_FILE_CACHE.get(filename);
  if (!cached) {
    return errorResponse("File not found", 404);
  }

  return new Response(cached.bytes.buffer as ArrayBuffer, {
    headers: {
      ...corsHeaders,
      "Content-Type": cached.type,
      "Content-Length": cached.bytes.byteLength.toString(),
      "Cache-Control": "public, max-age=3600, immutable",
    },
  });
}
