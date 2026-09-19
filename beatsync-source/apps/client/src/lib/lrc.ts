export interface LrcLine {
  /** Timestamp in seconds */
  time: number;
  text: string;
}

/** Parse an LRC file string into an array of timestamped lines. */
export function parseLrc(raw: string): LrcLine[] {
  const lines: LrcLine[] = [];

  for (const line of raw.split("\n")) {
    const match = /^\[(\d{2}):(\d{2})\.(\d{2})\](.*)$/.exec(line.trim());
    if (!match) continue;

    const minutes = parseInt(match[1], 10);
    const seconds = parseInt(match[2], 10);
    const centiseconds = parseInt(match[3], 10);
    const text = match[4].trim().replaceAll("\\n", "\n");
    if (!text) continue;

    const time = minutes * 60 + seconds + centiseconds / 100;
    lines.push({ time, text });
  }

  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Find the index of the current lyric line for a given playback time.
 * Returns -1 if playback hasn't reached the first line yet.
 */
export function getCurrentLineIndex(data: { lines: LrcLine[]; timeSeconds: number }): number {
  const { lines, timeSeconds } = data;
  let idx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= timeSeconds) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}
