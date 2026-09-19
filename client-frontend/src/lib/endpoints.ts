/** A tunneled phone must use the public page origin, never that host on private port 8080. */
export function participantEndpoints(pageOrigin: string, overrides: { api?: string; ws?: string } = {}) {
  const api = (overrides.api || pageOrigin).replace(/\/$/, "");
  return { api, wsUrl: overrides.ws || `${api.replace(/^http/, "ws")}/ws` };
}
