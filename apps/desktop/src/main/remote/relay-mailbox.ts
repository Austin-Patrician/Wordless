import type { RemoteInviteEnvelope } from "@wordless/remote-control";
import type { RemoteMailbox } from "./host-service.ts";

/**
 * 中继信箱的 HTTP 实现(桌面端写入/撤回加密邀请)。
 *
 * 单独成文件是为了**能被测试**:之前它内联在 `main/index.ts` 里,于是"地址填错/中继没起来"时
 * 用户只看到一句 `fetch failed` —— 既不知道是哪个地址失败,也不知道该去哪查。
 * 现在失败信息里带上**具体的 URL 与原因**,而且这几条路径都有测试守着。
 */

export interface RelayMailboxOptions {
	/** 便于测试注入;真实运行用全局 fetch。 */
	readonly fetchImpl?: typeof fetch;
	/** 失败时是否把原始原因也带出来(默认带)。 */
	readonly includeCause?: boolean;
}

export function createRelayMailbox(options: RelayMailboxOptions = {}): RemoteMailbox {
	const doFetch = options.fetchImpl ?? globalThis.fetch;

	return {
		publish: async (boxUrl, token, envelope: RemoteInviteEnvelope): Promise<void> => {
			const response = await request(doFetch, boxUrl, {
				method: "PUT",
				headers: { "x-wordless-invite-token": token, "content-type": "application/json" },
				body: JSON.stringify(envelope),
			});
			if (!response.ok) {
				throw new Error(
					`中继拒绝了这次写入(${response.status})。检查中继地址是否正确,以及它是否在运行:${boxUrl}`,
				);
			}
		},

		withdraw: async (boxUrl, token): Promise<void> => {
			// 撤回失败不必打断用户:邀请会在 10 分钟内自己过期,而且它只在内存里。
			await request(doFetch, boxUrl, { method: "DELETE", headers: { "x-wordless-invite-token": token } }).catch(
				() => undefined,
			);
		},
	};
}

async function request(doFetch: typeof fetch, url: string, init: RequestInit): Promise<Response> {
	try {
		return await doFetch(url, init);
	} catch (error) {
		// 关键:把**地址**和**原因**一起说出来。只有 `fetch failed` 的话,用户无从下手。
		const cause = error instanceof Error && error.message.length > 0 ? `(${error.message})` : "";
		throw new Error(`连不上中继的地址 ${url}${cause}。检查这个地址是否写对、中继进程是否在运行。`);
	}
}
