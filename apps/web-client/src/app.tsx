import { parseInviteQr } from "@wordless/remote-control";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ConnectView } from "./connect-view";
import { RemoteClient, defaultRelayBaseUrl } from "./remote-client";
import { applyTheme, readThemePreference, writeThemePreference, type ThemePreference } from "./theme";
import { ThreadView } from "./thread-view";

/**
 * 浏览器客户端入口。
 *
 * 两条进入路径:上次配对过就直接恢复(不用再输码);否则显示配对页。
 * 另外支持 `#/PAIR/<连接码>/<密码>` —— 二维码用手机相机扫开时走的就是这一条,一个字都不用敲。
 */
/**
 * 主题偏好。
 *
 * 三件事:**落存储**(下次打开还是这一档)、**落到 `data-theme`**、**跟随系统时监听系统变化**
 * (用户傍晚开了系统的深色模式,网页端不该还亮着)。
 * 首帧由 `index.html` 里的内联脚本负责,这里管的是"之后"。
 */
function useThemePreference(): { readonly theme: ThemePreference; readonly setTheme: (next: ThemePreference) => void } {
	const [theme, setTheme] = useState<ThemePreference>(() =>
		readThemePreference(typeof localStorage === "undefined" ? undefined : localStorage),
	);
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => applyTheme(document.documentElement, theme, media.matches);
		apply();
		// 只有"跟随系统"这一档才需要监听:手动选了浅色/深色时,系统怎么变都与它无关。
		if (theme !== "system") return;
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [theme]);
	const change = useCallback((next: ThemePreference) => {
		writeThemePreference(typeof localStorage === "undefined" ? undefined : localStorage, next);
		setTheme(next);
	}, []);
	return { theme, setTheme: change };
}

export function App() {
	const client = useMemo(() => new RemoteClient(), []);
	const state = useSyncExternalStore(client.subscribe, client.getState);
	const [restoring, setRestoring] = useState(true);
	/**
	 * 主题偏好。
	 *
	 * **必须在这里调用**:下面有两个提前 return(正在连接 / 还没配对),
	 * 把它写在 return 之后的话,从"配对页"切到"线程页"时 hook 数量会变 ——
	 * React 会直接抛异常,用户看到的就是**白屏**。踩过一次了。
	 */
	const { theme, setTheme } = useThemePreference();

	/**
	 * 扫码打开时走这里:地址里带着连接码与密码。
	 *
	 * 用**协议包里的同一个解析器**,而不是在这里另写一个正则 —— 二维码的两种形态(网页地址/自定义协议)
	 * 与 `?relay=` 覆盖都在那一处处理,否则"带 relay 参数的二维码"会在这里悄悄失效。
	 */
	const pairFromHash = useCallback(async (): Promise<boolean> => {
		const location = globalThis.location;
		if (!location || location.hash.length === 0) return false;
		const parsed = parseInviteQr(location.href);
		if (!parsed) return false;
		await client.pairWithCode({
			code: parsed.code,
			password: parsed.password,
			...(parsed.relayBaseUrl === undefined ? {} : { relayBaseUrl: parsed.relayBaseUrl }),
		});
		// 配对完成后把码从地址栏去掉:它会留在浏览历史与截图里。
		globalThis.history?.replaceState(null, "", location.pathname);
		return true;
	}, [client]);

	useEffect(() => {
		void (async () => {
			if (await pairFromHash()) {
				setRestoring(false);
				return;
			}
			await client.restore();
			setRestoring(false);
		})();
	}, [client, pairFromHash]);

	if (restoring) {
		return (
			<div className="flex min-h-dvh items-center justify-center bg-background">
				<p className="text-[0.8rem] text-muted-foreground">正在连接…</p>
			</div>
		);
	}

	if (state.phase === "idle" || state.phase === "pairing" || state.phase === "error" || state.deviceName === undefined) {
		return (
			<ConnectView
				state={state}
				onPairWithCode={(input) => void client.pairWithCode({ ...input, relayBaseUrl: defaultRelayBaseUrl() })}
				onPairWithQrText={(text) => void client.pairWithQrText(text)}
				onDisconnect={() => void client.disconnect()}
			/>
		);
	}

	return (
		<ThreadView
			state={state}
			onOpenSession={(sessionId) => void client.openSession(sessionId)}
			onSend={(text) => void client.send(text)}
			onAbort={() => void client.abort()}
			onRefresh={() => void client.listSessions()}
			// 部分 mock(测试里)与旧版本可能没有这两个方法 —— 缺了就当"这台机器还不支持新建会话",
			// 而不是让整页崩掉(渲染期抛异常 = 白屏,这是踩过的坑)。
			onLoadEntries={() => {
				const read = client.loadCatalog;
				if (typeof read !== "function") return;
				void read.call(client);
			}}
			onCreateSession={(entryId, text, options) => {
				const create = client.createSession;
				if (typeof create !== "function") return Promise.resolve({ ok: false, message: "这台电脑还不支持新建会话" });
				return create.call(client, { entryId, text, ...options });
			}}
			entries={state.entries}
			creating={state.creating === true}
			onSetModel={(connectionId, modelId, thinkingLevel) => client.setModel(connectionId, modelId, thinkingLevel)}
			onLoadEarlier={() => void client.loadEarlier()}
			onRetry={(at) => void client.retry(at)}
			onDismissError={() => client.clearError()}
			onRetryTurn={(messageId) => client.retryTurn(messageId)}
			onSetPermissions={(patch) => client.setPermissions(patch)}
			onSetConnectors={(ids) => client.setConnectors(ids)}
			onSetMode={(mode) => client.setMode(mode)}
			onResolveApproval={(approvalId, approved) => client.resolveApproval(approvalId, approved)}
			onSetPendingSkills={(skillIds) => client.setPendingSkills(skillIds)}
			onAnswerRequest={(requestId, resolution) => client.answerRequest(requestId, resolution)}
			onCompact={() => client.compact()}
			onLoadSessionUsage={() => client.sessionUsage()}
			onUploadAttachment={(file) => client.uploadAttachment(file)}
			onRemoveAttachment={(uploadId) => client.removeAttachment(uploadId)}
			onSelectVersion={(messageId, version) => client.selectVersion(messageId, version)}
			onSetExpert={(selection) => client.setExpert(selection)}
			theme={theme}
			onThemeChange={setTheme}
			onDisconnect={() => void client.disconnect()}
		/>
	);
}
