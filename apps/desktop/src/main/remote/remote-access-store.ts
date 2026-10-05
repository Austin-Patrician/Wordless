import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RemoteAccessPreferences, RemotePairedDevice, RemoteSecretStore } from "./remote-access-service.ts";

/**
 * 远程访问的持久化:偏好进文件,密钥进系统凭据库。
 *
 * 为什么偏好**不放进 `AppPreferences`**:那是渲染层能整份读到的东西,而"哪些设备配对过"
 * 属于主机侧的安全状态,不该出现在渲染层随手可取的快照里。单独一个文件也让这块状态可以独立演进。
 *
 * 密钥一律走凭据库(系统钥匙串加密),文件里**只留哈希** —— 文件被拷走也拿不到能连上的凭据。
 */

export interface CredentialVaultLike {
	read(id: string): Promise<string | undefined>;
	write(id: string, value: string): Promise<void>;
	delete(id: string): Promise<void>;
}

export interface RemoteAccessStore {
	readPreferences(): Promise<RemoteAccessPreferences>;
	writePreferences(
		update: (current: RemoteAccessPreferences) => RemoteAccessPreferences,
	): Promise<RemoteAccessPreferences>;
	readonly secrets: RemoteSecretStore;
}

/**
 * 落盘形状。
 *
 * **这里是"哪些字段会被记住"的唯一清单** —— 内存里加了新字段却忘了加到这里,
 * 症状是"设置看起来生效了,下一次读回来又变回旧的"(真实抱怨:切换接入方式时档位抖动一下又弹回去)。
 * 所以有一条例例:把 `RemoteAccessPreferences` 填满 → 存 → 读 → 必须逐字段一样。
 */
interface StoredFile {
	readonly version: 1;
	readonly enabled: boolean;
	/** 接入方式(局域网 / 远程)。 */
	readonly mode?: "lan" | "remote";
	/** 当前生效的中继地址。 */
	readonly relayBaseUrl?: string;
	/** 用户自己填的远程地址(与上面分开存:切模式不该把它冲掉)。 */
	readonly remoteRelayBaseUrl?: string;
	readonly devices: readonly RemotePairedDevice[];
}

const EMPTY: RemoteAccessPreferences = { enabled: false, devices: [] };
const SECRET_PREFIX = "remote-control:";

export function createRemoteAccessStore(input: { readonly userDataPath: string; readonly vault: CredentialVaultLike }): RemoteAccessStore {
	const filePath = join(input.userDataPath, "remote-access.json");
	let cache: StoredFile | undefined;
	// 串行化写入:两次快速切换(开→关)不能让后一次被前一次覆盖。
	let queue: Promise<unknown> = Promise.resolve();

	const load = async (): Promise<StoredFile> => {
		if (cache) return cache;
		try {
			const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
			cache = normalize(parsed);
		} catch {
			// 文件不存在或读坏了:从空开始。宁可让用户重新配对,也不要拿一份半坏的设备列表去连。
			cache = { version: 1, enabled: false, devices: [] };
		}
		return cache;
	};

	const persist = async (next: StoredFile): Promise<void> => {
		cache = next;
		const temporary = `${filePath}.tmp`;
		await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
		await rename(temporary, filePath);
	};

	return {
		readPreferences: async () => toPreferences(await load()),

		writePreferences: (update) => {
			const run = queue.then(async () => {
				const current = toPreferences(await load());
				const updated = update(current);
				await persist({
					version: 1,
					enabled: updated.enabled,
					...(updated.mode === undefined ? {} : { mode: updated.mode }),
					...(updated.relayBaseUrl === undefined ? {} : { relayBaseUrl: updated.relayBaseUrl }),
					...(updated.remoteRelayBaseUrl === undefined
						? {}
						: { remoteRelayBaseUrl: updated.remoteRelayBaseUrl }),
					devices: updated.devices,
				});
				return updated;
			});
			queue = run.catch(() => undefined);
			return run;
		},

		secrets: {
			get: (id) => input.vault.read(`${SECRET_PREFIX}${id}`),
			put: (id, secret) => input.vault.write(`${SECRET_PREFIX}${id}`, secret),
			remove: (id) => input.vault.delete(`${SECRET_PREFIX}${id}`),
		},
	};
}

function toPreferences(file: StoredFile): RemoteAccessPreferences {
	return {
		enabled: file.enabled,
		...(file.mode === undefined ? {} : { mode: file.mode }),
		...(file.relayBaseUrl === undefined ? {} : { relayBaseUrl: file.relayBaseUrl }),
		...(file.remoteRelayBaseUrl === undefined ? {} : { remoteRelayBaseUrl: file.remoteRelayBaseUrl }),
		devices: [...file.devices],
	};
}

/** 读进来的东西一律当作不可信:字段不对就丢掉那一条,而不是把坏数据带进连接流程。 */
function normalize(value: unknown): StoredFile {
	if (typeof value !== "object" || value === null) return { version: 1, enabled: false, devices: [] };
	const record = value as Record<string, unknown>;
	const devices = Array.isArray(record.devices) ? record.devices.filter(isDevice).map(cleanDevice) : [];
	return {
		version: 1,
		enabled: record.enabled === true,
		...(record.mode === "lan" || record.mode === "remote" ? { mode: record.mode } : {}),
		...(typeof record.relayBaseUrl === "string" && record.relayBaseUrl.length > 0
			? { relayBaseUrl: record.relayBaseUrl }
			: {}),
		...(typeof record.remoteRelayBaseUrl === "string" && record.remoteRelayBaseUrl.length > 0
			? { remoteRelayBaseUrl: record.remoteRelayBaseUrl }
			: {}),
		devices,
	};
}

/**
 * 设备上那些**可选**字段也收一道。
 *
 * 一个拼错的 `mode`(或旧版本/手工改过的文件里写进来的别的值)不该让界面去猜它属于哪一档 ——
 * 收掉它就等于"没记下配对方式",而界面有专门的一组放这种。**丢掉整个设备**是不对的:
 * 那台手机本身是好的。
 */
function cleanDevice(device: RemotePairedDevice): RemotePairedDevice {
	if (device.mode === "lan" || device.mode === "remote") return device;
	const { mode: _invalid, ...rest } = device;
	return rest;
}

function isDevice(value: unknown): value is RemotePairedDevice {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (
		typeof record.id !== "string" ||
		record.id.length === 0 ||
		typeof record.name !== "string" ||
		typeof record.createdAt !== "number" ||
		typeof record.mobileSecretHash !== "string" ||
		!/^[0-9a-f]{64}$/.test(record.mobileSecretHash)
	) {
		return false;
	}
	// 钉住的身份(可选)必须是 32 字节 base64url —— 它是 X25519 公钥,不是任意字符串。
	if (record.mobileIdentityKey !== undefined) {
		if (typeof record.mobileIdentityKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(record.mobileIdentityKey)) {
			return false;
		}
	}
	return true;
}

export { EMPTY as EMPTY_REMOTE_ACCESS_FILE };
