export function participantLink(value: string, sessionId: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter an HTTP or HTTPS audience URL without credentials.");
  url.searchParams.set("session", sessionId);
  url.hash = "";
  return url.toString();
}

export const participantLinkKey = (sessionId: string) => `orchestra:participant-link:${sessionId}`;
