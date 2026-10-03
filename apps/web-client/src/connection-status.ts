import type { RemoteClientState } from "./remote-client";

/**
 * 顶部那条状态说的是什么。
 *
 * 抽出来是因为这里最容易**说假话**:以前不管重连了几次都只显示"正在重连",
 * 而当时根本没有重连动作 —— 用户等的是一个不会发生的事。
 * 现在重连是真的,于是"试了几次"就该说出来,试得多了还要告诉他去查什么。
 */
export interface ConnectionStatus {
	readonly tone: "ok" | "working" | "attention";
	readonly text: string;
}

/** 试到这个次数以上就不再是"抖一下",而是"连不上"。 */
const STRUGGLING_ATTEMPTS = 3;

export function connectionStatus(state: RemoteClientState): ConnectionStatus {
	if (state.phase === "offline") {
		const attempts = state.reconnectAttempts ?? 0;
		if (attempts >= STRUGGLING_ATTEMPTS) {
			return {
				tone: "attention",
				text: `一直连不上电脑(已重试 ${attempts} 次)。确认电脑上 Wordless 与中继还在运行,地址没变。`,
			};
		}
		return { tone: "working", text: attempts === 0 ? "与电脑的连接中断,正在重连" : `与电脑的连接中断,正在重连(第 ${attempts} 次)` };
	}
	if (state.phase === "error") return { tone: "attention", text: state.error ?? "连接出错" };
	/**
	 * **正在补齐断线期间的消息**。
	 *
	 * 这是最容易被误认为"空闲"的一种状态:链路是通的,但事件在补,界面什么都没动。
	 * 不说出来,用户看到的就是"显示空闲,其实电脑在跑"(真实抱怨)。
	 */
	if (state.phase === "recovering") return { tone: "working", text: "正在补齐断线期间的消息…" };
	// 电脑在跑:这里说的是**它在跑**这件事(具体在做什么挂在消息底部,见 `RunStatusLine`)。
	// 少了这一条,发完消息之后顶部会写着"空闲" —— 那是假话。
	if (state.running) return { tone: "working", text: "电脑正在执行" };
	if (state.phase === "online") return { tone: "ok", text: "空闲" };
	return { tone: "working", text: "连接中" };
}
