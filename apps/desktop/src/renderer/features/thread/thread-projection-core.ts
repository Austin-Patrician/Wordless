export type ProjectionChannel = "history" | "loading" | "metadata" | "tail-growth" | "timeline";

const CHANNEL_ORDER: readonly ProjectionChannel[] = [
  "timeline",
  "tail-growth",
  "loading",
  "metadata",
  "history",
];

export function sameReferenceArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export type TextDeltaKind = "reasoning" | "text";

export type TextDeltaSegment<TMetadata> = {
  chunks: string[];
  kind: TextDeltaKind;
  metadata: TMetadata;
};

export class TextDeltaAccumulator<TMetadata> {
  private readonly messages = new Map<string, TextDeltaSegment<TMetadata>[]>();

  add(messageId: string, kind: TextDeltaKind, chunk: string, metadata: TMetadata): void {
    const segments = this.messages.get(messageId) ?? [];
    const segment = segments.at(-1);
    if (segment?.kind === kind) {
      segment.chunks.push(chunk);
      segment.metadata = metadata;
    } else {
      segments.push({ chunks: [chunk], kind, metadata });
    }
    this.messages.set(messageId, segments);
  }

  clear(): void {
    this.messages.clear();
  }

  entries(): IterableIterator<[string, TextDeltaSegment<TMetadata>[]]> {
    return this.messages.entries();
  }

  get size(): number {
    return this.messages.size;
  }
}

export type ChunkBatch<TMetadata> = { chunks: string[]; metadata: TMetadata };

export class ChunkAccumulator<TKey, TMetadata> {
  private readonly batches = new Map<TKey, ChunkBatch<TMetadata>>();

  add(key: TKey, chunk: string, metadata: TMetadata): void {
    const batch = this.batches.get(key);
    if (batch) {
      batch.chunks.push(chunk);
      batch.metadata = metadata;
    } else {
      this.batches.set(key, { chunks: [chunk], metadata });
    }
  }

  clear(): void {
    this.batches.clear();
  }

  entries(): IterableIterator<[TKey, ChunkBatch<TMetadata>]> {
    return this.batches.entries();
  }

  values(): IterableIterator<ChunkBatch<TMetadata>> {
    return this.batches.values();
  }

  get size(): number {
    return this.batches.size;
  }
}

export class BoundedIdCache {
  private readonly ids = new Set<string>();
  private readonly slots: string[] = [];
  private readonly capacity: number;
  private cursor = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new Error("BoundedIdCache capacity must be a positive integer");
    this.capacity = capacity;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    if (this.slots.length < this.capacity) {
      this.slots.push(id);
      return;
    }
    const evicted = this.slots[this.cursor];
    if (evicted !== undefined) this.ids.delete(evicted);
    this.slots[this.cursor] = id;
    this.cursor = (this.cursor + 1) % this.capacity;
  }

  clear(): void {
    this.ids.clear();
    this.slots.length = 0;
    this.cursor = 0;
  }

  get size(): number {
    return this.ids.size;
  }
}

export class ThreadProjectionPublisher {
  private readonly channelListeners = new Map<ProjectionChannel, Set<() => void>>();
  private readonly rowListeners = new Map<string, Set<() => void>>();
  private readonly pendingChannels = new Set<ProjectionChannel>();
  private readonly pendingRows = new Set<string>();
  private transactionDepth = 0;

  subscribe(channel: ProjectionChannel, listener: () => void): () => void {
    let listeners = this.channelListeners.get(channel);
    if (!listeners) {
      listeners = new Set();
      this.channelListeners.set(channel, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.channelListeners.delete(channel);
    };
  }

  subscribeRow(key: string, listener: () => void): () => void {
    let listeners = this.rowListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.rowListeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.rowListeners.delete(key);
    };
  }

  publish(channel: ProjectionChannel): void {
    if (this.transactionDepth > 0) {
      this.pendingChannels.add(channel);
      return;
    }
    this.emit(this.channelListeners.get(channel));
  }

  publishRow(key: string): void {
    if (this.transactionDepth > 0) {
      this.pendingRows.add(key);
      return;
    }
    this.emit(this.rowListeners.get(key));
  }

  transaction<T>(operation: () => T): T {
    this.transactionDepth += 1;
    try {
      return operation();
    } finally {
      this.transactionDepth -= 1;
      if (this.transactionDepth === 0) this.flush();
    }
  }

  dispose(): void {
    this.pendingChannels.clear();
    this.pendingRows.clear();
    this.channelListeners.clear();
    this.rowListeners.clear();
  }

  private flush(): void {
    for (const channel of CHANNEL_ORDER) {
      if (channel === "metadata") {
        for (const key of this.pendingRows)
          this.emit(this.rowListeners.get(key));
        this.pendingRows.clear();
      }
      if (this.pendingChannels.has(channel))
        this.emit(this.channelListeners.get(channel));
    }
    this.pendingChannels.clear();
    if (this.pendingRows.size > 0) {
      for (const key of this.pendingRows)
        this.emit(this.rowListeners.get(key));
      this.pendingRows.clear();
    }
  }

  private emit(listeners: ReadonlySet<() => void> | undefined): void {
    if (!listeners) return;
    for (const listener of listeners) listener();
  }
}
