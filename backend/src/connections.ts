export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export const REPLACED_CODE = 4001;
export const RESET_CODE = 4002;

export class ConnectionRegistry {
  private readonly participants = new Map<number, ClientSocket>();
  private readonly operators = new Set<ClientSocket>();

  resetParticipants(): void {
    const sockets = [...this.participants.values()];
    this.participants.clear(); // Late close events must not touch a newly allocated device.
    for (const socket of sockets) socket.close(RESET_CODE, "Audience reset. Refresh to join the next session.");
  }

  // A second authenticated connection for one identity replaces the first, so a reopened tab
  // takes over instead of two sockets both believing they speak for the device.
  bindParticipant(deviceId: number, socket: ClientSocket): void {
    const previous = this.participants.get(deviceId);
    this.participants.set(deviceId, socket);
    if (previous && previous !== socket) previous.close(REPLACED_CODE, "Replaced by a newer connection.");
  }

  // Returns false when a replaced socket closes late: it no longer speaks for the device, so
  // its close must not mark a live connection offline.
  releaseParticipant(deviceId: number, socket: ClientSocket): boolean {
    if (this.participants.get(deviceId) !== socket) return false;
    this.participants.delete(deviceId);
    return true;
  }

  participantSocket(deviceId: number): ClientSocket | undefined {
    return this.participants.get(deviceId);
  }

  // A device with no open socket is simply skipped: it learns the same state from its snapshot
  // when it reconnects, so a missed broadcast is not a missed cue.
  sendToParticipants(deviceIds: Iterable<number>, message: string): number {
    let delivered = 0;
    for (const deviceId of deviceIds) {
      const socket = this.participants.get(deviceId);
      if (!socket) continue;
      socket.send(message);
      delivered++;
    }
    return delivered;
  }

  /**
   * Sends a per-device message to many devices without holding the event loop. Assigning a
   * thousand phones built a thousand distinct payloads in one tick and stalled the server for
   * hundreds of milliseconds; this yields between chunks instead.
   *
   * Nothing awaits this. A missed broadcast is recoverable from a snapshot by design, so delivery
   * is best effort and correctness never depends on it.
   */
  async sendEachToParticipants(
    deviceIds: readonly number[],
    build: (deviceId: number) => string,
    chunkSize = 100,
  ): Promise<number> {
    let delivered = 0;
    for (let index = 0; index < deviceIds.length; index += chunkSize) {
      for (const deviceId of deviceIds.slice(index, index + chunkSize)) {
        const socket = this.participants.get(deviceId);
        // Building the payload only for devices that can receive it: an absent phone learns this
        // from its snapshot instead.
        if (!socket) continue;
        socket.send(build(deviceId));
        delivered++;
      }
      if (index + chunkSize < deviceIds.length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return delivered;
  }

  addOperator(socket: ClientSocket): void {
    this.operators.add(socket);
  }

  removeOperator(socket: ClientSocket): void {
    this.operators.delete(socket);
  }

  get operatorCount(): number {
    return this.operators.size;
  }

  broadcastToOperators(message: string): void {
    for (const socket of this.operators) socket.send(message);
  }
}

// Operator telemetry is coalesced: state changes set a flag, and at most one snapshot is sent
// per interval. A join wave or a probe burst must not turn into one broadcast per event.
export class OperatorTelemetry {
  private dirty = false;
  private lastSentMs: number | null = null;

  constructor(private readonly minIntervalMs = 500) {}

  mark(): void {
    this.dirty = true;
  }

  due(nowMs: number): boolean {
    if (!this.dirty) return false;
    if (this.lastSentMs !== null && nowMs - this.lastSentMs < this.minIntervalMs) return false;
    this.dirty = false;
    this.lastSentMs = nowMs;
    return true;
  }
}
