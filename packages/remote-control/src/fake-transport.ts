import { encodeRemoteFrame, parseRemoteFrame } from "./protocol.ts";
import type { RemoteFrame, RemoteTransport, RemoteTransportHandlers } from "./types.ts";

/**
 * 假传输:把两个端点直接连起来,并让测试**完全控制投递时机、丢帧与断线**。
 *
 * 为什么值得单独写一个:真实链路的故障(丢帧、对端消失、重连)在真机上很难复现,
 * 而这些恰恰是协议里最容易写错的地方。有了它,P0 的验收**不需要真手机、不需要任何云账号**。
 *
 * 帧会走一遍 `encodeRemoteFrame` / `parseRemoteFrame` —— 假的传输也要真的过一遍校验,
 * 否则测出来的"通过"是假的。
 */

interface QueuedFrame {
	readonly to: "a" | "b";
	readonly text: string;
}

export class FakeTransportPair {
	readonly a: FakeTransport;
	readonly b: FakeTransport;
	private readonly queue: QueuedFrame[] = [];
	private dropCount = 0;
	private disconnected = false;
	private readonly delivered: string[] = [];
	private readonly raw: string[] = [];

	constructor() {
		this.a = new FakeTransport(this, "a");
		this.b = new FakeTransport(this, "b");
	}

	/** 投递队列里的全部帧(包括投递过程中新产生的)。 */
	flush(): void {
		while (this.deliverOne()) {
			/* 继续投递 */
		}
	}

	/** 只投递一帧 —— 需要交错两个方向时用。 */
	deliverOne(): boolean {
		const item = this.queue.shift();
		if (!item) return false;
		if (this.dropCount > 0) {
			this.dropCount -= 1;
			return true;
		}
		const target = item.to === "a" ? this.a : this.b;
		const frame = parseRemoteFrame(item.text);
		this.delivered.push(`${item.to}:${frame.type}`);
		this.raw.push(item.text);
		target.receive(frame);
		return true;
	}

	/** 接下来 N 帧静默丢弃(模拟丢包)。 */
	dropNext(count: number): void {
		this.dropCount = count;
	}

	/** 断开两侧(模拟对端消失 / 网络中断)。 */
	disconnect(reason = "network down"): void {
		this.disconnected = true;
		this.queue.length = 0;
		this.a.closedByPeer(reason);
		this.b.closedByPeer(reason);
	}

	/**
	 * 只断开一侧 —— 模拟"对端不在线,但我还活着"。
	 * 之后发给这一侧的帧会被静默丢弃,另一侧照常发送(它的出站日志会记住这些事件)。
	 */
	closeSide(side: "a" | "b", reason = "peer offline"): void {
		(side === "a" ? this.a : this.b).closedByPeer(reason);
	}

	get pending(): number {
		return this.queue.length;
	}

	/** 投递过的帧类型序列,便于断言"到底发了什么"。 */
	get transcript(): readonly string[] {
		return this.delivered;
	}

	/** 投递过的原始帧文本。测试用它来重放或改动一帧(链路重传、密文被改)。 */
	get rawFrames(): readonly string[] {
		return this.raw;
	}

	/**
	 * 把一段原始帧文本直接投给某一侧。
	 * 用来模拟"链路重传同一帧"和"密文在途中被改动" —— 这两种故障真机上很难复现,但必须处理对。
	 */
	reinjectRaw(text: string, side: "a" | "b"): void {
		const target = side === "a" ? this.a : this.b;
		target.receive(parseRemoteFrame(text));
	}

	/** 内部:一侧发出的帧进入队列。 */
	enqueue(from: "a" | "b", text: string): void {
		if (this.disconnected) return;
		this.queue.push({ to: from === "a" ? "b" : "a", text });
	}
}

export class FakeTransport implements RemoteTransport {
	private readonly pair: FakeTransportPair;
	private readonly side: "a" | "b";
	private handlers: RemoteTransportHandlers | undefined;
	private connected = false;

	constructor(pair: FakeTransportPair, side: "a" | "b") {
		this.pair = pair;
		this.side = side;
	}

	async connect(handlers: RemoteTransportHandlers): Promise<void> {
		this.handlers = handlers;
		this.connected = true;
	}

	async send(frame: RemoteFrame): Promise<void> {
		if (!this.connected) throw new Error("fake transport is not connected");
		this.pair.enqueue(this.side, encodeRemoteFrame(frame));
	}

	async close(reason = "closed"): Promise<void> {
		this.connected = false;
		this.handlers?.onClose(reason);
	}

	/** 内部:收到一帧。 */
	receive(frame: RemoteFrame): void {
		if (!this.connected) return;
		this.handlers?.onFrame(frame);
	}

	/** 内部:对端断开。 */
	closedByPeer(reason: string): void {
		if (!this.connected) return;
		this.connected = false;
		this.handlers?.onClose(reason);
	}
}
