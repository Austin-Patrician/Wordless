import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 网页端外壳的**切换**测试。
 *
 * 这一条是为一个真事故写的:主题 hook 被写在提前 return 之后 —— 配对页 → 线程页切换时
 * hook 数量变化,React 直接抛异常,用户看到的是**白屏**(而且只在"连上之后"出现)。
 *
 * 仓库里没有 ESLint(`react-hooks/rules-of-hooks` 本来能静态抓住它),所以这里用"真的切一次"
 * 来守住这一类:**从还没配对切到已配对,组件必须能活下来。**
 */

const client = {
	/** 占位:`beforeEach` 会用网页端的**初始状态**覆盖它(写死一份就会漏字段)。 */
	state: {} as Record<string, unknown>,
	listeners: new Set<() => void>(),
	// 与真实实现一样用箭头属性:`subscribe` 会被脱开传进 `useSyncExternalStore`,普通方法会丢 `this`。
	subscribe: (listener: () => void) => {
		client.listeners.add(listener);
		return () => client.listeners.delete(listener);
	},
	getState: () => client.state,
	restore: async () => false,
	pairWithCode: async () => undefined,
	pairWithQrText: async () => undefined,
	disconnect: async () => undefined,
	listSessions: async () => undefined,
	openSession: async () => undefined,
	send: async () => undefined,
	retry: async () => undefined,
	abort: async () => undefined,
	setModel: async () => ({ ok: true }),
	loadEarlier: async () => undefined,
	clearError: () => undefined,
};

vi.mock("../../web-client/src/remote-client", async (importOriginal) => {
	// **把真实模块里的其余导出透出去**:只替换 `RemoteClient`,别把 `INITIAL_REMOTE_STATE` 这类
	// 一起吞掉 —— 测试里从 mock 里 import 它们会拿到 undefined(这次就是这么炸的)。
	const actual = await importOriginal<typeof import("../../web-client/src/remote-client")>();
	return {
		...actual,
		RemoteClient: function RemoteClient() {
			return client;
		},
		defaultRelayBaseUrl: () => "ws://relay.example",
	};
});

const { App } = await import("../../web-client/src/app");
const { INITIAL_REMOTE_STATE } = await import("../../web-client/src/remote-client");

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
	// 直接用网页端的**初始状态**:加字段时这里不用跟着改(抄一份就会漏一份)。
	client.state = { ...INITIAL_REMOTE_STATE, phase: "idle" };
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

const push = (next: Record<string, unknown>) => {
	client.state = { ...client.state, ...next };
	act(() => {
		for (const listener of client.listeners) listener();
	});
};

describe("网页端外壳的页面切换", () => {
	it("从配对页切到线程页:hook 顺序不能变(变了就是白屏)", async () => {
		// `restore()` 是异步的:要等它落地,否则看到的是"正在连接…"那一屏。
		await act(async () => {
			root.render(<App />);
		});
		expect(container.textContent).toContain("远程连接");

		// 配对成功:同一个组件实例要接着活下来。
		push({
			phase: "online",
			deviceName: "我的手机",
			sessions: [{ id: "s1", title: "修一下登录页", updatedAt: 1, running: false }],
		});
		expect(container.textContent).toContain("Wordless 远程");
		expect(container.textContent).toContain("修一下登录页");

		// 再切回去,也不能炸。
		push({ phase: "idle", deviceName: undefined });
		expect(container.textContent).toContain("远程连接");
	});
});
