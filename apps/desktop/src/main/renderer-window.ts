/**
 * 往渲染层发消息 —— **"能不能发"只在这里判断一次**。
 *
 * 为什么要有这个模块:Electron 里往一个**渲染帧已经销毁**的窗口 `send`,**不抛异常**,
 * 而是在主进程里打一行
 *
 *     Error sending from webFrameMain: Error: Render frame was disposed before WebFrameMain could be accessed
 *
 * 它出现在几个真正常见的时刻:窗口正在关、渲染层正在重载、以及那些"开了又关"的辅助窗口
 * (OCR 运行器、设计离屏栅格池)。而这条路上原来有六处 `webContents.send`,只有两处记得检查 ——
 * 于是这行报错时不时冒出来,还带着一串谁也看不懂的栈。
 *
 * 所以判断只写一份,而且**发不出去不是错误**:那一刻没有收件人,不是出了故障。
 *
 * 类型是**结构化的**(不是 `BrowserWindow`):这个模块因此不需要 Electron 就能测
 * (仓库里主进程的那批测试是 `node --test` 直接跑的)。
 */

/** 一个"能收消息的窗口"最小的样子(真身是 `BrowserWindow`)。 */
export interface RendererWindowLike {
	isDestroyed(): boolean;
	readonly webContents: {
		isDestroyed(): boolean;
		isCrashed(): boolean;
		isLoadingMainFrame(): boolean;
		send(channel: string, payload: unknown): void;
	};
}

/**
 * 这个窗口现在能收消息吗。
 *
 * 三个"不能"各有各的来头:
 * - `isDestroyed()` —— 窗口已经没了;
 * - `isCrashed()` —— 渲染进程崩了:帧还在,但没人接;
 * - `isLoadingMainFrame()` —— **帧正在被换掉**(重载、切页)。这一刻旧帧已经销毁、新帧还没接上,
 *   往它发就是那句 "Render frame was disposed"。
 *
 * 重载期间**丢掉事件是安全的**:桌面端的渲染层是"**快照 + 变化时刷新**"(见
 * `renderer/shared/runtime.tsx`),挂载时会重新拉一次快照 —— 所以它不需要一条连续的流,
 * 而一个正在被销毁的 JS 上下文本来也接不住事件。
 */
export function isRendererWindowAlive(window: RendererWindowLike | undefined): window is RendererWindowLike {
	if (!window || window.isDestroyed()) return false;
	const contents = window.webContents;
	if (!contents || contents.isDestroyed()) return false;
	if (contents.isCrashed()) return false;
	return !contents.isLoadingMainFrame();
}

/**
 * 发一条。返回"发出去了没有",**不抛异常**。
 *
 * `try/catch` 也留着:判断与 `send` 之间帧仍可能被销毁(重载的时序就是这样),而这条调用链
 * 挂在**运行时的事件流**上 —— 在那里抛异常会顺着 `emit` 冒进 agent 那一轮里,
 * 代价远大于少一条事件。
 */
export function sendToRendererWindow(
	window: RendererWindowLike | undefined,
	channel: string,
	payload: unknown,
): boolean {
	if (!isRendererWindowAlive(window)) return false;
	try {
		window.webContents.send(channel, payload);
		return true;
	} catch {
		return false;
	}
}
