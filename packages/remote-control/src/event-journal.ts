import type { RemoteEvent, RemoteEventJournalPort } from "./types.ts";

export interface RemoteEventJournalOptions {
	/** 最多保留多少条事件;超出的被淘汰,之后重连的对端必须整体重拉。 */
	readonly capacity?: number;
	/** 事件最多保留多久(毫秒)。 */
	readonly maxAgeMs?: number;
	readonly now?: () => number;
}

interface JournalEntry {
	readonly event: RemoteEvent;
	readonly recordedAt: number;
}

/**
 * 一端对**一个对端**的出站事件日志。
 *
 * 它比任何单条传输活得久 —— 这正是"换链路(中继→别的链路)或重连之后序号仍然连续、只补缺失尾部"的前提。
 * 同时按**条数与时长**双上限淘汰:对端不在时不能让本机无限占内存;淘汰之后明确告诉对端"补不了,整体重拉"。
 */
export class RemoteEventJournal implements RemoteEventJournalPort {
	private readonly entries: JournalEntry[] = [];
	private sequence = 0;
	private oldestKeptSequence = 0;
	private readonly capacity: number;
	private readonly maxAgeMs: number;
	private readonly now: () => number;

	constructor(options: RemoteEventJournalOptions = {}) {
		this.capacity = Math.max(1, options.capacity ?? 512);
		this.maxAgeMs = Math.max(0, options.maxAgeMs ?? 5 * 60_000);
		this.now = options.now ?? Date.now;
	}

	get lastSequence(): number {
		return this.sequence;
	}

	nextSequence(): number {
		this.sequence += 1;
		return this.sequence;
	}

	remember(event: RemoteEvent): void {
		this.entries.push({ event, recordedAt: this.now() });
		this.evict();
	}

	/** 对端确认收到某序号之后,它之前的事件就可以扔了。 */
	acknowledge(sequence: number): void {
		while (this.entries.length > 0 && this.entries[0].event.sequence <= sequence) this.entries.shift();
		this.oldestKeptSequence = Math.max(this.oldestKeptSequence, sequence);
	}

	replay(afterSequence: number): readonly RemoteEvent[] | undefined {
		this.evict();
		// 比本日志记过的还大:说明日志是新的一份(端点重启过),对端会把接下来每个事件都当"已见过"丢掉。
		if (afterSequence > this.sequence) return undefined;
		if (afterSequence === this.sequence) return [];
		if (afterSequence < this.oldestKeptSequence) return undefined;
		return this.entries.filter((entry) => entry.event.sequence > afterSequence).map((entry) => entry.event);
	}

	private evict(): void {
		const cutoff = this.now() - this.maxAgeMs;
		while (this.entries.length > 0 && (this.entries.length > this.capacity || this.entries[0].recordedAt < cutoff)) {
			const evicted = this.entries.shift() as JournalEntry;
			this.oldestKeptSequence = Math.max(this.oldestKeptSequence, evicted.event.sequence);
		}
	}
}
