/** Handled worker failures arrive as JSON diagnostics, separate from the exit status. */
export function jobMessage(progress: { stage: string; message: string }, diagnostics: string[]): string {
  if (progress.stage !== "failed") return progress.message;
  for (const line of [...diagnostics].reverse()) {
    try {
      const detail: unknown = JSON.parse(line);
      if (typeof detail === "object" && detail !== null && "error" in detail && typeof detail.error === "string" && detail.error.trim()) {
        return `${detail.error.trim()} (${progress.message})`;
      }
    } catch { /* Plain logs remain available in the diagnostic details. */ }
  }
  return progress.message;
}
