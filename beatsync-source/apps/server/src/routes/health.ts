import { globalManager } from "@/managers";
import { jsonResponse } from "@/utils/responses";

const startedAt = Date.now();

export function handleHealth(): Response {
  return jsonResponse({
    status: "ok",
    uptimeMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    rooms: globalManager.getRoomCount(),
  });
}
