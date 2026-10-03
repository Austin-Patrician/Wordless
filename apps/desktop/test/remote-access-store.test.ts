import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sha256Hex } from "@wordless/remote-control";
import { createRemoteAccessHandlers } from "../src/main/remote/handlers.ts";
import {
	RemoteAccessService,
	type RemoteAccessPreferences,
	type RemoteSecretStore,
} from "../src/main/remote/remote-access-service.ts";
import { createRemoteAccessStore, type CredentialVaultLike } from "../src/main/remote/remote-access-store.ts";
import type { RemoteSessionSurface } from "../src/main/remote/host-service.ts";

/**
 * 远程访问的持久化与 IPC 边界。
 *
 * 这里钉住的是**安全边界**:文件里只有哈希、密钥走凭据库、坏文件不会带出坏连接、
 * 以及渲染层传进来的东西一律先校验。
 */

const surface: RemoteSessionSurface = {
	listSessions: async () => [],
	openSession: async () => undefined,
	historyPage: async () => ({ messages: [] }),
	prompt: async () => undefined,
	abort: async () => undefined,
	subscribe: () => () => undefined,
};

const createVault = (): CredentialVaultLike & { readonly values: Map<string, string> } => {
	const values = new Map<string, string>();
	return {
		values,
		read: async (id) => values.get(id),
		write: async (id, value) => void values.set(id, value),
		delete: async (id) => void values.delete(id),
	};
};

const withTempDir = async (run: (path: string) => Promise<void>): Promise<void> => {
	const path = await mkdtemp(join(tmpdir(), "wordless-remote-"));
	try {
		await run(path);
	} finally {
		await rm(path, { recursive: true, force: true });
	}
};

describe("持久化", () => {
	it("没写过时是空的(不开、没有设备)", async () => {
		await withTempDir(async (path) => {
			const store = createRemoteAccessStore({ userDataPath: path, vault: createVault() });
			assert.deepEqual(await store.readPreferences(), { enabled: false, devices: [] });
		});
	});

	it("开关与设备列表能往返,并且真的落到文件", async () => {
		await withTempDir(async (path) => {
			const store = createRemoteAccessStore({ userDataPath: path, vault: createVault() });
			await store.writePreferences(() => ({
				enabled: true,
				relayBaseUrl: "wss://relay.example",
				devices: [{ id: "d1", name: "我的手机", createdAt: 1, mobileSecretHash: sha256Hex("x") }],
			}));
			const reopened = createRemoteAccessStore({ userDataPath: path, vault: createVault() });
			const preferences = await reopened.readPreferences();
			assert.equal(preferences.enabled, true);
			assert.equal(preferences.relayBaseUrl, "wss://relay.example");
			assert.equal(preferences.devices.length, 1);
			const raw = await readFile(join(path, "remote-access.json"), "utf8");
			assert.match(raw, /"version": 1/);
		});
	});

	it("文件里不出现任何明文密钥", async () => {
		await withTempDir(async (path) => {
			const vault = createVault();
			const store = createRemoteAccessStore({ userDataPath: path, vault });
			await store.secrets.put("relay-secret-d1", "super-secret-value");
			await store.writePreferences(() => ({
				enabled: true,
				devices: [{ id: "d1", name: "", createdAt: 1, mobileSecretHash: sha256Hex("phone") }],
			}));
			const raw = await readFile(join(path, "remote-access.json"), "utf8");
			assert.equal(raw.includes("super-secret-value"), false);
			// 密钥只进了凭据库。
			assert.equal(vault.values.get("remote-control:relay-secret-d1"), "super-secret-value");
			assert.equal(await store.secrets.get("relay-secret-d1"), "super-secret-value");
		});
	});

	it("坏文件不会带出坏连接:字段不对的设备被丢掉", async () => {
		await withTempDir(async (path) => {
			await writeFile(
				join(path, "remote-access.json"),
				JSON.stringify({
					version: 1,
					enabled: true,
					devices: [
						{ id: "good", name: "", createdAt: 1, mobileSecretHash: sha256Hex("ok") },
						{ id: "bad", name: "", createdAt: 1, mobileSecretHash: "not-a-hash" },
						{ id: "worse" },
					],
				}),
				"utf8",
			);
			const store = createRemoteAccessStore({ userDataPath: path, vault: createVault() });
			const preferences = await store.readPreferences();
			assert.deepEqual(preferences.devices.map((device) => device.id), ["good"]);
		});
	});

	it("钉住的身份会持久化;形状不对的身份被丢掉", async () => {
		await withTempDir(async (path) => {
			const identity = "A".repeat(43);
			await writeFile(
				join(path, "remote-access.json"),
				JSON.stringify({
					version: 1,
					enabled: true,
					devices: [
						{ id: "pinned", name: "我的手机", createdAt: 1, mobileSecretHash: sha256Hex("a"), mobileIdentityKey: identity },
						{ id: "bad-key", name: "", createdAt: 1, mobileSecretHash: sha256Hex("b"), mobileIdentityKey: "太短" },
					],
				}),
				"utf8",
			);
			const store = createRemoteAccessStore({ userDataPath: path, vault: createVault() });
			const preferences = await store.readPreferences();
			assert.deepEqual(preferences.devices.map((device) => device.id), ["pinned"]);
			assert.equal(preferences.devices[0].mobileIdentityKey, identity);
		});
	});

	it("文件读坏时从空开始,而不是崩", async () => {
		await withTempDir(async (path) => {
			await writeFile(join(path, "remote-access.json"), "{ 这不是 JSON", "utf8");
			const store = createRemoteAccessStore({ userDataPath: path, vault: createVault() });
			assert.deepEqual(await store.readPreferences(), { enabled: false, devices: [] });
		});
	});

	it("并发写入被串行化(后一次不会被前一次覆盖)", async () => {
		await withTempDir(async (path) => {
			const store = createRemoteAccessStore({ userDataPath: path, vault: createVault() });
			await Promise.all([
				store.writePreferences((current) => ({ ...current, enabled: true })),
				store.writePreferences((current) => ({ ...current, relayBaseUrl: "wss://relay.example" })),
			]);
			const preferences = await store.readPreferences();
			assert.equal(preferences.enabled, true);
			assert.equal(preferences.relayBaseUrl, "wss://relay.example");
		});
	});
});

describe("IPC 边界", () => {
	const buildService = async () => {
		let preferences: RemoteAccessPreferences = { enabled: true, devices: [] };
		const service = new RemoteAccessService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			readPreferences: async () => preferences,
			writePreferences: async (update) => {
				preferences = update(preferences);
				return preferences;
			},
			secrets: createVault() as unknown as RemoteSecretStore,
			createTransport: () => {
				throw new Error("测试里不真的连");
			},
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
			defaultRelayBaseUrl: "ws://127.0.0.1:8787",
		});
		// 真实装配里 `start()` 在应用启动时跑完才可能收到 IPC;这里照做,否则读到的只是默认值。
		await service.start();
		return createRemoteAccessHandlers(service);
	};

	it("读状态不需要载荷", async () => {
		const handlers = await buildService();
		const state = await handlers.getState();
		assert.equal(state.enabled, true);
		assert.deepEqual(state.devices, []);
	});

	it("开关必须给布尔值", async () => {
		const handlers = await buildService();
		await assert.rejects(() => handlers.setEnabled({ enabled: "yes" }), /布尔值/);
		await assert.rejects(() => handlers.setEnabled(undefined), /对象/);
		assert.equal((await handlers.setEnabled({ enabled: false })).enabled, false);
	});

	it("中继地址必须像地址", async () => {
		const handlers = await buildService();
		// `http://` 会被指出真正的问题:协议写错了(而不是含糊的"地址不合法")。
		await assert.rejects(() => handlers.setRelayUrl({ relayBaseUrl: "http://relay.example" }), /要用 ws:\/\/ 或 wss:\/\//);
		assert.equal((await handlers.setRelayUrl({ relayBaseUrl: "wss://relay.example" })).relayBaseUrl, "wss://relay.example");
		// 清空 -> 回落默认。
		assert.equal((await handlers.setRelayUrl({ relayBaseUrl: "" })).relayBaseUrl, "ws://127.0.0.1:8787");
	});

	it("保存中继地址时会补上默认端口(少写端口是最常见的笔误)", async () => {
		const handlers = await buildService();
		const state = await handlers.setRelayUrl({ relayBaseUrl: "ws://192.168.1.109" });
		assert.equal(state.relayBaseUrl, "ws://192.168.1.109:8787");
	});

	it("中继地址写法不对时明确拒绝(带路径这种)", async () => {
		const handlers = await buildService();
		await assert.rejects(() => handlers.setRelayUrl({ relayBaseUrl: "ws://relay.example:8787/v2/relay" }), /不要带路径/);
	});

	it("没有地址时测试连接给出明确结论,而不是发一个空请求", async () => {
		// 这个构建没有默认中继,用户也没填 —— 这时不该真的去发请求。
		const service = new RemoteAccessService({
			surface,
			deviceId: "desk-1",
			deviceName: "我的电脑",
			readPreferences: async () => ({ enabled: false, devices: [] }),
			writePreferences: async (update) => update({ enabled: false, devices: [] }),
			secrets: createVault() as unknown as RemoteSecretStore,
			createTransport: () => {
				throw new Error("不该走到这里");
			},
			mailbox: { publish: async () => undefined, withdraw: async () => undefined },
		});
		const handlers = createRemoteAccessHandlers(service);
		const result = await handlers.testRelay({});
		assert.equal(result.ok, false);
		assert.match(result.detail, /还没有填中继地址/);
	});

	it("撤销设备必须给设备 id", async () => {
		const handlers = await buildService();
		await assert.rejects(() => handlers.revokeDevice({}), /deviceId/);
		await assert.rejects(() => handlers.revokeDevice({ deviceId: "" }), /deviceId/);
	});

	it("撤回邀请是幂等的(没有邀请也不报错)", async () => {
		const handlers = await buildService();
		const state = await handlers.withdrawInvite();
		assert.equal(state.invite, undefined);
	});
});
