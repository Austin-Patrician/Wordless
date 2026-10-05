import type { RemoteWorkspaceReference } from "@wordless/remote-control";

/**
 * `@` 搜索这一条路**为什么需要自己的一个模块**。
 *
 * 它每敲一个字就会发一次请求,而请求的另一头是本机在**一个真目录树上做检索**。手机上的字是
 * 一个一个敲出来的,所以真正的问题不是"能不能搜到",而是**"别把电脑拖垮、也别让输入框卡住"**。
 * 这里把三件保证写成纯函数,让它们可以被 `node --test` 钉住(视图里只剩调用):
 *
 * 1. **同一段查询不重复问**:结果缓存 5 秒(与桌面端同一个时长)。用户打错一个字母再退回来,
 *    不该再走一趟中继。
 * 2. **只认最新那一次**:先发的请求后回来时**丢掉**(`isStale`)—— 否则界面上显示的是
 *    上一个查询的结果,而用户已经在看下一个了。
 * 3. **缓存有上限**:一轮会话里用户可能试几十个词,缓存不能无限长下去(手机内存是真的紧张)。
 *
 * 视图那一侧还欠一条**防抖**(停止输入 150ms 才发) —— 那是"等用户把手停下来"的定时器,
 * 只活在组件里,搬不进纯函数。
 */

/** 结果缓存多久(毫秒)。与桌面端同值:两端"退回来要不要重新搜"的体感该一致。 */
export const WORKSPACE_SEARCH_TTL_MS = 5_000;
/**
 * 停止输入多久之后才真的发请求(毫秒)。与桌面端同值。
 *
 * 手机上的输入是**一个字一个字**进来的:不防抖的话,"src/renderer"这十来个字符会变成
 * 十来个请求,而每一个都要穿过中继、在本机的索引上跑一遍。
 */
export const WORKSPACE_SEARCH_DEBOUNCE_MS = 120;
/** 最多记这么多条查询的结果(超出丢最旧的)。 */
export const WORKSPACE_SEARCH_CACHE_LIMIT = 40;
/**
 * 选择器里最多摆这么多行。
 *
 * 与"键盘能走到哪儿"必须是**同一个数**:分两处写的话,用户按几下方向键就会走到看不见的那一行,
 * 按回车选中一个屏幕上没高亮的东西 —— 那种错很难说清,只能靠这里只有一份。
 */
export const WORKSPACE_PICKER_MAX_ROWS = 8;

/**
 * 摆进选择器的顺序:目录在前,然后按路径。
 *
 * **只在这里排一次**,而且视图与键盘都用它的结果 —— 第一版把排序写在渲染里、键盘却用原始数组,
 * 于是"高亮的是 Composer.tsx、回车选中的是 src/renderer"(测试抓到了)。这类错必须让它无从发生。
 */
export function orderWorkspaceMatches(
	entries: readonly RemoteWorkspaceReference[],
	maxRows = WORKSPACE_PICKER_MAX_ROWS,
): readonly RemoteWorkspaceReference[] {
	return [...entries]
		.sort((left, right) => {
			if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
			return left.path.localeCompare(right.path);
		})
		.slice(0, Math.max(1, maxRows));
}

/**
 * 一条路径拆成**名字**与**它所在的目录**。
 *
 * 为什么必须拆开:手机上一条 `src/renderer/features/thread/Composer.tsx` 挤在一行里,
 * 截断之后是一团谁也不是的东西(`…features/thread/Composer.tsx`),用户既看不出文件名从哪开始,
 * 也看不出它在哪个目录。拆开之后各占一段:名字是**要认的那一个**,目录是**用来区分同名文件的**。
 *
 * 名字以本机给的那份为准(它是权威的显示名),目录从路径里减出来 —— 减不出来(形状变了)时
 * 退回"最后一个斜杠之前",而不是把整条路径当成名字。
 */
export function workspacePathParts(entry: {
	readonly path: string;
	readonly name: string;
}): { readonly name: string; readonly directory: string } {
	const cut = entry.path.lastIndexOf("/");
	const name = entry.name.length > 0 ? entry.name : entry.path.slice(cut + 1);
	if (name.length === 0) return { name: entry.path, directory: "" };
	if (entry.path === name) return { name, directory: "" };
	const suffix = `/${name}`;
	if (entry.path.endsWith(suffix)) {
		return { name, directory: entry.path.slice(0, entry.path.length - suffix.length) };
	}
	return { name, directory: cut <= 0 ? "" : entry.path.slice(0, cut) };
}

export interface WorkspaceSearchCache {
	/** 有还没过期的一份就返回它,否则 `undefined`。 */
	read(key: string, now: number): readonly RemoteWorkspaceReference[] | undefined;
	write(key: string, results: readonly RemoteWorkspaceReference[], now: number): void;
	clear(): void;
}

/**
 * 缓存键。
 *
 * 大小写与首尾空白**都归一化**:`App` 与 `app ` 在本机的索引里搜出来是同一批文件,
 * 分两个键只会让第二次照样发请求。会话 id 一起进键 —— 换会话之后工作区也换了,
 * 拿上一个会话的结果去回答新会话是**错的**(不是慢)。
 */
export function workspaceSearchKey(sessionId: string | undefined, query: string): string {
	return `${sessionId ?? ""}\u0000${query.trim().toLocaleLowerCase()}`;
}

export function createWorkspaceSearchCache(
	options: { readonly ttlMs?: number; readonly limit?: number } = {},
): WorkspaceSearchCache {
	const ttlMs = options.ttlMs ?? WORKSPACE_SEARCH_TTL_MS;
	const limit = Math.max(1, options.limit ?? WORKSPACE_SEARCH_CACHE_LIMIT);
	const entries = new Map<string, { readonly expiresAt: number; readonly results: readonly RemoteWorkspaceReference[] }>();
	return {
		read(key, now) {
			const hit = entries.get(key);
			if (!hit) return undefined;
			if (hit.expiresAt <= now) {
				entries.delete(key);
				return undefined;
			}
			// 命中就挪到队尾:淘汰时丢的是**最久没用过**的那一条,而不是最早写进来的。
			entries.delete(key);
			entries.set(key, hit);
			return hit.results;
		},
		write(key, results, now) {
			entries.delete(key);
			entries.set(key, { expiresAt: now + ttlMs, results });
			while (entries.size > limit) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
		},
		clear() {
			entries.clear();
		},
	};
}

/**
 * 这次请求的结果**该不该用**。
 *
 * 每一次搜索都带一个自增的序号,回来时比一下:不是最后一次发出的那个,就丢掉。
 * 少了这一条,慢的那次后回来会**盖掉**新结果 —— 用户看到的是自己上一个词的文件列表。
 */
export function isStaleSearch(issued: number, latest: number): boolean {
	return issued !== latest;
}

/**
 * 本机不认识这个方法(老版本桌面端)。
 *
 * 那时候不该反复重试:每一次都只是把同一个失败再问一遍。远端据此**这次连接内**就不再摆选择器
 * (视图里那个 `unsupported` 标记),而不是每敲一个字都弹一次"不支持"。
 */
export function isUnsupportedMethod(error: { readonly code?: string; readonly message?: string } | undefined): boolean {
	if (!error) return false;
	if (error.code !== "not_found") return false;
	return /unsupported method/i.test(error.message ?? "");
}
