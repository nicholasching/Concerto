// A retry must not become a second mutation. Results are kept for the whole session, with a cap
// so a misbehaving client cannot grow the map without bound.
export class CommandLog {
  private readonly results = new Map<string, unknown>();

  clear(): void { this.results.clear(); }

  constructor(private readonly limit = 10_000) {}

  get<T>(commandId: string): T | undefined {
    return this.results.get(commandId) as T | undefined;
  }

  remember(commandId: string, result: unknown): void {
    this.results.set(commandId, result);
    if (this.results.size <= this.limit) return;
    const oldest = this.results.keys().next();
    if (!oldest.done) this.results.delete(oldest.value);
  }

  get size(): number {
    return this.results.size;
  }
}
