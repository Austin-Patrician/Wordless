import type { RemoteSessionMessage } from "@wordless/remote-control";

/**
 * 输入区:草稿、高度、以及"这条消息到底发出去了没有"。
 *
 * 这三件事都对应手机上的真实麻烦:
 * - **草稿**:手机上切个应用回来,页面被系统回收是常事 —— 打了半屏的字不该没;
 * - **高度**:单行输入框写长提示词非常难受,但也不能让输入框把对话挤没;
 * - **发送状态**:以前发出去就把气泡画成"已发送",失败了也照画 —— 用户以为发出去了。
 */

/** 最多长到这么高(约 8 行)。再长就内部滚动,不让输入区吃掉整个屏幕。 */
export const COMPOSER_MAX_HEIGHT_PX = 160;
/** 一份草稿最多留这么多字:存储是有限的,而且超长内容本来就该在电脑上写。 */
export const MAX_DRAFT_CHARS = 20_000;
/** 最多记这么多个会话的草稿(按最近使用保留)。 */
export const MAX_DRAFT_SESSIONS = 20;
export const DRAFT_STORAGE_KEY = "wordless.remote.drafts";

/** 输入框该多高:内容多高就多高,但不超过上限。 */
export function clampComposerHeight(scrollHeight: number, maxPx: number = COMPOSER_MAX_HEIGHT_PX): number {
	if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return 0;
	return Math.min(Math.round(scrollHeight), maxPx);
}

export type DraftMap = Readonly<Record<string, string>>;

/** 读草稿。存储坏了、值是别的形状,一律当成"没有草稿",而不是抛给调用方。 */
export function readDrafts(storage?: Pick<Storage, "getItem">): DraftMap {
	if (!storage) return {};
	try {
		const raw = storage.getItem(DRAFT_STORAGE_KEY);
		if (raw === null) return {};
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
		const drafts: Record<string, string> = {};
		for (const [sessionId, text] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof text === "string" && text.length > 0) drafts[sessionId] = text.slice(0, MAX_DRAFT_CHARS);
		}
		return drafts;
	} catch {
		return {};
	}
}

/**
 * 写一份草稿。
 *
 * 空文本 = **删掉这一条**(而不是留一个空字符串):否则"我发完了"之后,
 * 存储里会留下一堆空条目,而且下次切回来会显示成"有草稿"。
 */
export function writeDraft(
	storage: Pick<Storage, "setItem"> | undefined,
	drafts: DraftMap,
	sessionId: string | undefined,
	text: string,
): DraftMap {
	if (!storage || sessionId === undefined) return drafts;
	const trimmed = text.slice(0, MAX_DRAFT_CHARS);
	const next: Record<string, string> = {};
	// 刚写的这个排在最前:超量时先丢最久没用过的。
	if (trimmed.length > 0) next[sessionId] = trimmed;
	for (const key of Object.keys(drafts)) {
		if (key === sessionId) continue;
		next[key] = drafts[key];
		if (Object.keys(next).length >= MAX_DRAFT_SESSIONS) break;
	}
	try {
		storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
	} catch {
		// 存不下(配额满、隐私模式)不是错误:草稿这次还在内存里,只是下次打开会没有。
	}
	return next;
}

export function draftFor(drafts: DraftMap, sessionId: string | undefined): string {
	return sessionId === undefined ? "" : (drafts[sessionId] ?? "");
}

/** 消息上的发送状态。**只存在于网页端**:它描述的是"这一端发出去了没有",本机不知道。 */
export interface SentState {
	readonly pending?: boolean;
	readonly failed?: boolean;
}

/**
 * 把一条乐观画出来的消息落位。
 *
 * 靠 `at` 定位那一条(它是这一端生成的,不会与历史里的消息撞车)。
 * 失败时**保留文本并标成失败**,而不是把它删掉 —— 用户打了字,删掉等于让他重打。
 */
export function settleSent(
	messages: readonly (RemoteSessionMessage & SentState)[],
	at: number,
	patch: SentState,
): readonly (RemoteSessionMessage & SentState)[] {
	return messages.map((message) =>
		message.at === at && message.role === "user" && message.pending === true ? { ...message, ...patch } : message,
	);
}
