import type { RemoteAccessService, RemoteAccessState } from "./remote-access-service.ts";
import { normalizeRelayAddress, probeRelay, type RelayProbeResult } from "./relay-address.ts";

/**
 * 远程访问的 IPC 逻辑。
 *
 * **刻意不 import Electron**:所有校验与调用都在这里,`register-remote-ipc.ts` 只做转接。
 * 这样这段逻辑可以直接测,而且渲染层与主进程之间的契约在类型上是看得见的
 * (照 `notifications/webhook/handlers.ts` 的做法)。
 *
 * 载荷只有三个标量(开关、中继地址、设备 id),所以这里手写校验而不是引入 schema:
 * 一旦载荷变成结构化对象,就应当换成 `@wordless/protocol` 里的 typebox schema —— 与消息推送那边一致。
 */

export interface RemoteAccessHandlers {
	getState(): Promise<RemoteAccessState>;
	setEnabled(payload: unknown): Promise<RemoteAccessState>;
	setRelayUrl(payload: unknown): Promise<RemoteAccessState>;
	createInvite(): Promise<RemoteAccessState>;
	/** 探一次中继:让用户在生成二维码**之前**就知道地址通不通。 */
	testRelay(payload: unknown): Promise<RelayProbeResult>;
	withdrawInvite(): Promise<RemoteAccessState>;
	revokeDevice(payload: unknown): Promise<RemoteAccessState>;
}

export function createRemoteAccessHandlers(service: RemoteAccessService): RemoteAccessHandlers {
	return {
		getState: async () => service.getState(),

		setEnabled: async (payload) => {
			const enabled = readBoolean(payload, "enabled");
			return service.setEnabled(enabled);
		},

		setRelayUrl: async (payload) => {
			const raw = readOptionalString(payload, "relayBaseUrl");
			if (raw === undefined) return service.setRelayBaseUrl(undefined);
			// 规范化在**保存时**做:少写端口是最常见的笔误,这里补上并让界面拿到规范值回显。
			return service.setRelayBaseUrl(normalizeRelayAddress(raw).webSocketUrl);
		},

		createInvite: async () => service.createInvite(),

		testRelay: async (payload) => {
			const raw = readOptionalString(payload, "relayBaseUrl") ?? service.getState().relayBaseUrl;
			if (raw === undefined) return { ok: false, detail: "还没有填中继地址" };
			return probeRelay(raw);
		},

		withdrawInvite: async () => {
			await service.withdrawInvite();
			return service.getState();
		},

		revokeDevice: async (payload) => {
			const deviceId = readString(payload, "deviceId");
			return service.revokeDevice(deviceId);
		},
	};
}

function asRecord(payload: unknown): Record<string, unknown> {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		throw new Error("载荷必须是对象");
	}
	return payload as Record<string, unknown>;
}

function readBoolean(payload: unknown, field: string): boolean {
	const value = asRecord(payload)[field];
	if (typeof value !== "boolean") throw new Error(`${field} 必须是布尔值`);
	return value;
}

function readString(payload: unknown, field: string): string {
	const value = asRecord(payload)[field];
	if (typeof value !== "string" || value.length === 0) throw new Error(`${field} 必须是非空字符串`);
	return value;
}

function readOptionalString(payload: unknown, field: string): string | undefined {
	const value = asRecord(payload)[field];
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error(`${field} 必须是字符串`);
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed;
}
