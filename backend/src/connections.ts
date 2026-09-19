export interface ClientSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export const REPLACED_CODE = 4001;

export class ConnectionRegistry {
  private readonly participants = new Map<number, ClientSocket>();
  private readonly operators = new Set<ClientSocket>();

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
