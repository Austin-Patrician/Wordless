import type { RemoteSessionMessage } from "@wordless/remote-control";

/**
 * 输入区里**不依赖编辑器**的那几件事:草稿、`@` 的识别、以及"这条消息到底发出去了没有"。
 *
 * 三件都对应手机上的真实麻烦:
 * - **草稿**:手机上切个应用回来,页面被系统回收是常事 —— 打了半屏的字不该没
 *   (现在存的是**序列化后的编辑器状态**:挑过的文件也是内容);
 * - **`@` 的识别**:敲了 `@` 该不该弹选择器、选中之后去掉哪一段 —— 纯文本判断,两端同一套规则;
 * - **发送状态**:以前发出去就把气泡画成"已发送",失败了也照画 —— 用户以为发出去了。
 *
 * (输入框的高度不在这里:它是编辑器(见 `composer-editor.tsx`),内容多高它就多高。)
 */

/** 一份草稿最多留这么多字:存储是有限的,而且超长内容本来就该在电脑上写。 */
export const MAX_DRAFT_CHARS = 20_000;
/** 最多记这么多个会话的草稿(按最近使用保留)。 */
export const MAX_DRAFT_SESSIONS = 20;
export const DRAFT_STORAGE_KEY = "wordless.remote.drafts";

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

/**
 * 输入框里的 `@`(搜工作区文件)。
 *
 * 触发规则与桌面端**同源**(那边是 `inline-skill-composer-model.ts` 的 `WORKSPACE_MENTION_RE`):
 * `@` 必须在**行首或空白之后**,查询串里不能有空白 —— 于是 `foo@bar.com` 不会把选择器弹出来。
 * 两端用同一条规则,是因为"手机上打 `@` 出来了、电脑上没有"这种不一致没人查得清。
 *
 * 这一层只做**纯文本判断**:它不知道文件存不存在,也不发请求。所以它能被 `node --test` 直接测。
 */
/**
 * 输入框里的**触发符**:`@` 找文件,`$` 找技能。
 *
 * 两套规则**逐字同源**(与桌面端 `inline-skill-composer-model.ts` 里的两个正则一样):
 * 触发符必须在**行首或空白之后**,查询串里不能有空白 —— 于是 `foo@bar.com` 不会弹选择器,
 * 而 `$100` 那种写法(前面没有空白)也不会。
 */
export type ComposerMentionKind = "workspace" | "skill";

const MENTION_PATTERNS: Record<ComposerMentionKind, RegExp> = {
	workspace: /(?:^|\s)@([^\s@$!！]*)$/,
	skill: /(?:^|\s)\$([^\s@$!！]*)$/,
};

/** 查询串超过这么长就不再当引用看了:那不是"找东西",是误粘贴。 */
export const MENTION_MAX_QUERY_CHARS = 64;
/** 一条消息最多挂这么多个文件引用(与本机侧的上限一致 —— 两边不一致时用户会在发送那一刻才发现)。 */
export const MAX_WORKSPACE_REFERENCES = 20;

/**
 * 光标前那个还没写完的触发符后面跟着的查询串。没有就是 `undefined`。
 *
 * 只认**光标之前**的那一段(与桌面端一样):用户把光标挪到句子中间时,触发符在光标之后 ——
 * 那时候弹选择器只会挡住他正在看的地方。
 */
export function mentionQueryAt(text: string, caret: number, kind: ComposerMentionKind): string | undefined {
	if (!Number.isFinite(caret)) return undefined;
	const at = Math.max(0, Math.min(Math.trunc(caret), text.length));
	const match = MENTION_PATTERNS[kind].exec(text.slice(0, at));
	if (!match) return undefined;
	const query = match[1] ?? "";
	return query.length > MENTION_MAX_QUERY_CHARS ? undefined : query;
}

/**
 * 光标前那段 `@…` / `$…` 从**第几个字**开始(没有就是 `null`)。
 *
 * 选中一条之后要把这段去掉、换成一枚 token —— 而"从哪去掉"必须与"怎么认出来的"是同一套规则,
 * 所以它与 `mentionQueryAt` 共用同一个正则。返回的是**下标**而不是新字符串:
 * 编辑器那边是在一个文本节点里改内容,不是拼字符串。
 */
export function stripTrailingMention(prefix: string, kind: ComposerMentionKind): number | null {
	const match = MENTION_PATTERNS[kind].exec(prefix);
	if (!match) return null;
	const query = match[1] ?? "";
	return prefix.length - query.length - 1;
}

/** 技能图标上的那个字:中文取首字,英文取首字母(与桌面端 `skillIconText` 一致)。 */
export function skillIconText(name: string): string {
	const first = name.trim()[0];
	if (!first) return "?";
	return /[一-龥]/.test(first) ? first : first.toUpperCase();
}

/**
 * 目录太长时怎么显示。
 *
 * 手机上一条目录常常比整行还长(`apps/desktop/src/renderer/features/thread`),而**越靠后越具体** ——
 * 用户正是靠它区分两个同名的文件。所以从**前面**截,并在截断处留一个 `…`:
 * 一眼能看出"这不是完整路径",而不是以为目录就叫这个名字。
 *
 * (CSS 的 `truncate` 只能从**后面**截 —— 那样丢掉的是最具体的那一段,所以这一层得自己做。)
 */
export function shortWorkspacePath(path: string, maxChars = 28): string {
	if (path.length <= maxChars) return path;
	return `…${path.slice(path.length - maxChars + 1)}`;
}

/**
 * 消息上的发送状态。**只存在于网页端**:它描述的是"这一端发出去了没有",本机不知道。
 */
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
