import type {
	RemoteLanStatus,
	RemoteAccessDeviceView as ProtocolRemoteAccessDeviceView,
	RemoteAccessInviteView as ProtocolRemoteAccessInviteView,
	RemoteAccessState as ProtocolRemoteAccessState,
} from "@wordless/protocol";
import {
	decodePublicKey,
	generateIdentityKeyPair,
	randomToken,
	sha256Hex,
	type RemoteIdentityKeyPair,
	type RemoteLogger,
	type RemoteTransport,
} from "@wordless/remote-control";
import { LanHost, type LanHostOptions } from "./lan-host.ts";
import {
	RemoteHostService,
	type RemoteInvite,
	type RemoteMailbox,
	type RemoteSessionSurface,
} from "./host-service.ts";

/**
 * 主进程侧的远程访问:把"偏好、配对记录、每台设备一条中继链路、邀请生命周期"收在一处。
 *
 * 几个刻意的决定:
 *
 * 1. **一台设备一个房间**。每部手机独立配对、独立撤销 —— 丢了手机只作废那一台,不用重新配其他设备。
 * 2. **密钥不落明文偏好**。偏好里只存哈希;中继密钥与手机密钥走 `secretStore`(真实实现接系统凭据库)。
 * 3. **未领取的邀请只在内存里**。进程重启就作废,重新生成即可 —— 比"为了保住邀请把明文密钥写进磁盘"划算。
 * 4. **没开就什么都不做**:不开端口、不连中继、不订阅运行时(用户没开远程时,本机不为它付出任何代价)。
 */

export interface RemotePairedDevice {
	/** 就是配对 id。 */
	readonly id: string;
	readonly name: string;
	readonly createdAt: number;
	readonly lastSeenAt?: number;
	/** 只存哈希:中继据此只认那一台手机。 */
	readonly mobileSecretHash: string;
	/**
	 * 首次配对成功后钉住的手机身份公钥(base64url)。
	 *
	 * 有了它,即使那台手机的密钥后来泄露、或有人拿到了旧邀请,也换不进这个配对 ——
	 * 身份在**派生会话密钥之前**就会被比对。
	 */
	readonly mobileIdentityKey?: string;
	/**
	 * 这台手机是在**哪一种接入方式**下配对的(见 `RemoteAccessDeviceView.mode`)。
	 *
	 * 旧数据里没有这一项 —— 界面会把它单独放一组("没记下配对方式"),而不是猜一个。
	 */
	readonly mode?: "lan" | "remote";
}

export interface RemoteAccessPreferences {
	readonly enabled: boolean;
	/**
	 * 接入方式。缺省时按"有没有填过远程地址"推:填过就是远程(老用户),没填过就是局域网。
	 */
	readonly mode?: "lan" | "remote";
	/** **当前生效**的中继地址(局域网模式下由网卡地址 + 端口算出来)。 */
	readonly relayBaseUrl?: string;
	/** 用户自己填的**远程**中继地址。与上面分开存,否则切一次模式就把人填的地址冲掉了。 */
	readonly remoteRelayBaseUrl?: string;
	readonly devices: readonly RemotePairedDevice[];
	/** 局域网模式下用户选中的那一个本机地址(多网卡时由用户挑)。 */
	readonly lanAddress?: string;
}

export const EMPTY_REMOTE_ACCESS_PREFERENCES: RemoteAccessPreferences = { enabled: false, devices: [] };

/**
 * 密钥存放(真实实现:系统凭据库)。**绝不写进偏好文件。**
 *
 * 接口是**异步**的,因为系统凭据库就是异步的(加密/解密要走系统钥匙串)。
 * 写成同步会逼出一个坏设计:启动时把所有密钥预读进内存。
 */
export interface RemoteSecretStore {
	get(id: string): Promise<string | undefined>;
	put(id: string, secret: string): Promise<void>;
	remove(id: string): Promise<void>;
}

// 对外的状态形状定义在 `@wordless/protocol`(桥接口、渲染层、主进程共用一份)。
type RemoteAccessInviteView = ProtocolRemoteAccessInviteView;
type RemoteAccessDeviceView = ProtocolRemoteAccessDeviceView;
export type RemoteAccessState = ProtocolRemoteAccessState;

export interface RemoteAccessServiceOptions {
	readonly surface: RemoteSessionSurface;
	readonly deviceId: string;
	readonly deviceName: string;
	readonly readPreferences: () => Promise<RemoteAccessPreferences>;
	readonly writePreferences: (
		update: (current: RemoteAccessPreferences) => RemoteAccessPreferences,
	) => Promise<RemoteAccessPreferences>;
	readonly secrets: RemoteSecretStore;
	/** 桌面端长期身份。取不到时现生成一份(仅内存)。 */
	readonly loadIdentity?: () => RemoteIdentityKeyPair | undefined;
	readonly saveIdentity?: (identity: RemoteIdentityKeyPair) => void;
	readonly createTransport: (url: string, protocols: readonly string[]) => RemoteTransport;
	readonly mailbox: RemoteMailbox;
	readonly defaultRelayBaseUrl?: string;
	readonly logger?: RemoteLogger;
	readonly now?: () => number;
	readonly inviteTtlMs?: number;
	/**
	 * 有一台设备接上来时通知用户(主进程里接系统通知)。
	 *
	 * 每次接入都通知,不做"窗口在前台就跳过":这是一件**安全相关**的事,
	 * 而它很罕见 —— 用户宁可偶尔多看一眼,也不要不知道自己的电脑正在被远程使用。
	 */
	readonly onDeviceConnected?: (device: { readonly deviceId: string; readonly name: string }) => void;
	/**
	 * 局域网模式:**在主进程里把中继起起来,并把网页客户端托管出去**。
	 *
	 * 不给这个选项时(测试、或还没接线的宿主)状态里就没有 `lan` 那一块 —— 界面据此不显示这一档,
	 * 而不是显示一个点了没反应的开关。
	 */
	readonly lan?: Omit<LanHostOptions, "port"> & { readonly port?: number };
}

interface DeviceRuntime {
	readonly record: RemotePairedDevice;
	readonly host: RemoteHostService;
	readonly mobileSecret: string;
}

export class RemoteAccessService {
	private readonly options: RemoteAccessServiceOptions;
	private preferences: RemoteAccessPreferences = EMPTY_REMOTE_ACCESS_PREFERENCES;
	private readonly devices = new Map<string, DeviceRuntime>();
	private identity: RemoteIdentityKeyPair;
	private invite: { readonly deviceId: string; readonly view: RemoteAccessInviteView } | undefined;
	private lastError: string | undefined;
	private readonly lan: LanHost | undefined;
	private listeners = new Set<() => void>();

	constructor(options: RemoteAccessServiceOptions) {
		this.options = options;
		this.lan = options.lan === undefined ? undefined : new LanHost(options.lan);
		this.identity = options.loadIdentity?.() ?? generateIdentityKeyPair();
		if (!options.loadIdentity?.()) options.saveIdentity?.(this.identity);
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * 读偏好并拉起链路。**必须在开始处理 IPC 之前调用**:在那之前 `getState()` 只能给出默认值
	 * (会显示成"没开"),因为偏好还没读进来。
	 */
	async start(): Promise<void> {
		this.preferences = await this.options.readPreferences();
		if (!this.preferences.enabled) {
			this.notify();
			return;
		}
		await this.bringUpDevices();
		this.notify();
	}

	/**
	 * 停掉所有链路。
	 *
	 * **拆链路的失败不算"停不下来"**:传输层关不掉(对端没回 close、socket 已经断了)不该让
	 * "关闭远程接入"或"切换接入方式"这件事失败 —— 用户要的是"停掉",而链路已经不可用了。
	 * 所以这里一律吞掉错误,只保证状态被清干净。
	 */
	async stop(): Promise<void> {
		// 局域网服务也是"没开就不做":停的时候一起停,免得退出应用之后端口还占着。
		await this.lan?.stop().catch(() => undefined);
		for (const device of this.devices.values()) await device.host.stop().catch(() => undefined);
		this.devices.clear();
		this.invite = undefined;
		this.notify();
	}

	getState(): RemoteAccessState {
		const online = [...this.devices.values()].some((device) => device.host.state === "online");
		return {
			enabled: this.preferences.enabled,
			mode: this.mode(),
			...(this.relayBaseUrl() === undefined ? {} : { relayBaseUrl: this.relayBaseUrl() }),
			...(this.options.defaultRelayBaseUrl === undefined
				? {}
				: { defaultRelayBaseUrl: this.options.defaultRelayBaseUrl }),
			connection: !this.preferences.enabled ? "off" : online ? "online" : "connecting",
			...(this.invite === undefined ? {} : { invite: this.invite.view }),
			...(this.lan === undefined ? {} : { lan: this.lanStatus() }),
			devices: this.preferences.devices.map((device) => ({
				// `...device` 已经带上 `mode`:界面按它把设备分成"局域网配的/远程配的"两组。
				...device,
				online: this.devices.get(device.id)?.host.state === "online",
				paired: device.mobileIdentityKey !== undefined,
			})),
			...(this.lastError === undefined ? {} : { error: this.lastError }),
		};
	}

	async setEnabled(enabled: boolean): Promise<RemoteAccessState> {
		this.preferences = await this.options.writePreferences((current) => ({ ...current, enabled }));
		if (enabled) await this.bringUpDevices();
		else await this.stop();
		this.notify();
		return this.getState();
	}

	async setRelayBaseUrl(relayBaseUrl?: string): Promise<RemoteAccessState> {
		const trimmed = relayBaseUrl?.trim();
		this.preferences = await this.options.writePreferences((current) => {
			// 清空要**真的把字段删掉**,否则"覆盖"一直留着,回不到默认中继。
			const { remoteRelayBaseUrl: _previousRemote, relayBaseUrl: _previous, ...rest } = current;
			const next = trimmed === undefined || trimmed.length === 0 ? rest : { ...rest, remoteRelayBaseUrl: trimmed };
			// 远程地址只在**远程模式**下生效;局域网模式下的当前地址由网卡地址算出来,别被这里冲掉。
			return this.mode() === "remote" ? { ...next, ...(trimmed === undefined ? {} : { relayBaseUrl: trimmed }) } : next;
		});
		// 换中继意味着现有链路的目标变了:重连一次,而不是让它们继续连旧地址。
		await this.stop();
		if (this.preferences.enabled) await this.bringUpDevices();
		this.notify();
		return this.getState();
	}

	/**
	 * 切换接入方式。
	 *
	 * 两个方向都要**收尾干净**:切到远程要把局域网服务停掉(否则退出这个页面它还占着端口),
	 * 切到局域网要把服务起起来并改写成局域网地址。
	 *
	 * 局域网起不来时**不静默回退**:保留用户选的这一档,把原因显示出来,并保留原有的中继地址 ——
	 * 这样他要么修好(构建一次网页客户端),要么自己切回远程,而不是发现"设置被改了"。
	 */
	async setMode(mode: "lan" | "remote"): Promise<RemoteAccessState> {
		this.preferences = await this.options.writePreferences((current) => ({ ...current, mode }));
		if (mode === "remote") {
			await this.lan?.stop();
			this.preferences = await this.options.writePreferences((current) => {
				const { relayBaseUrl: _lanAddress, ...rest } = current;
				return {
					...rest,
					...(current.remoteRelayBaseUrl === undefined ? {} : { relayBaseUrl: current.remoteRelayBaseUrl }),
				};
			});
			this.lastError = undefined;
		} else {
			const started = await this.applyLanAddress();
			if (!started) return this.getState();
		}
		await this.stop();
		// 拉起链路失败(密钥丢了、中继连不上)由 `bringUpDevices` 记进 `lastError`,
		// 不该让"切换接入方式"这个动作失败 —— 档位已经切过去了。
		if (this.preferences.enabled) await this.bringUpDevices().catch(() => undefined);
		this.notify();
		return this.getState();
	}

	/**
	 * 局域网模式的总开关 —— **一键**就是这一下。
	 *
	 * 顺序是刻意的:先把服务起起来,**成功之后**才写地址、才开启。
	 * 起不来(没构建网页客户端 / 端口全被占)就原样把原因带回去,**不开启** ——
	 * 宁可不给,也不给一个"打开了但什么都没发生"的开关。
	 */
	async setLanMode(enabled: boolean): Promise<RemoteAccessState> {
		if (this.lan === undefined) return this.getState();
		if (!enabled) {
			await this.lan.stop();
			return this.setEnabled(false);
		}
		// 按了局域网这个开关,就是在说"我要用局域网":模式一起写进去 ——
		// 否则"当前地址已经是局域网地址,而模式还写着远程",下一步切模式时又会把地址改回去。
		this.preferences = await this.options.writePreferences((current) => ({ ...current, mode: "lan" }));
		if (!(await this.applyLanAddress())) {
			this.notify();
			return this.getState();
		}
		return this.setEnabled(true);
	}

	/**
	 * 起局域网服务并把**当前中继地址**改成局域网地址。成功返回 true。
	 *
	 * 中继地址就是**手机要打开的那个地址**:桌面端自己也连它(中继绑在所有网卡上),
	 * 于是二维码、网页地址、本机连接三者永远一致 —— 这是"手机绝不能用 127.0.0.1"的落地方式。
	 */
	private async applyLanAddress(): Promise<boolean> {
		if (this.lan === undefined) return false;
		const status = await this.lan.start();
		if (!status.running) {
			this.lastError = status.error ?? "局域网服务起不来。";
			return false;
		}
		const address = this.preferences.lanAddress ?? status.addresses[0]?.address;
		if (address === undefined) {
			await this.lan.stop();
			this.lastError = "这台机器上没找到可用的局域网地址(检查一下网络连接)。";
			return false;
		}
		this.preferences = await this.options.writePreferences((current) => ({
			...current,
			lanAddress: address,
			relayBaseUrl: `ws://${address}:${status.port ?? 0}`,
		}));
		this.lastError = undefined;
		return true;
	}

	/** 当前接入方式:存过就用存的,没存过按"有没有填过远程地址"推(老用户不该被悄悄切走)。 */
	private mode(): "lan" | "remote" {
		if (this.preferences.mode !== undefined) return this.preferences.mode;
		if (this.preferences.remoteRelayBaseUrl !== undefined) return "remote";
		if (this.options.defaultRelayBaseUrl !== undefined) return "remote";
		return this.lan === undefined ? "remote" : "lan";
	}

	/** 换一个网卡地址:重连一次(现有链路的目标变了),服务本身不用重启。 */
	async setLanAddress(address: string): Promise<RemoteAccessState> {
		if (this.lan === undefined) return this.getState();
		const status = this.lan.getStatus();
		if (!status.addresses.some((entry) => entry.address === address)) {
			this.lastError = "这个地址不在本机当前的网卡列表里。";
			this.notify();
			return this.getState();
		}
		this.preferences = await this.options.writePreferences((current) => ({ ...current, lanAddress: address }));
		if (status.running && this.mode() === "lan") {
			this.preferences = await this.options.writePreferences((current) => ({
				...current,
				relayBaseUrl: `ws://${address}:${status.port ?? 0}`,
			}));
			await this.stop();
			if (this.preferences.enabled) await this.bringUpDevices();
		}
		this.lastError = undefined;
		this.notify();
		return this.getState();
	}

	private lanStatus(): RemoteLanStatus {
		const status = this.lan?.getStatus();
		if (status === undefined) return { running: false, addresses: [], webClientReady: false };
		return {
			running: status.running,
			...(status.port === undefined ? {} : { port: status.port }),
			addresses: [...status.addresses],
			...(this.preferences.lanAddress === undefined ? {} : { selectedAddress: this.preferences.lanAddress }),
			webClientReady: status.webClientReady,
			...(status.portChanged ? { portChanged: true } : {}),
			...(status.error === undefined ? {} : { error: status.error }),
		};
	}

	/**
	 * 生成一次配对材料:新建一条设备记录(只有哈希落盘),并把加密邀请放进中继信箱。
	 * 手机凭连接码 + 密码取回它 —— 中继只看得到连接码的哈希。
	 */
	async createInvite(): Promise<RemoteAccessState> {
		const now = this.now();
		const relayBaseUrl = this.relayBaseUrl();
		if (relayBaseUrl === undefined) {
			this.lastError = "还没有配置中继地址,无法生成连接码。";
			this.notify();
			return this.getState();
		}
		await this.withdrawInvite();
		// **复用**这次运行里生成过、还没人领取的那一台。
		//
		// 用户点"重新生成二维码"(二维码过期了、或者只是想再拿一次)不该在设备列表里多出一台 ——
		// 那台旧的永远不会被领取,却会一直挂在那里,看起来像"我的手机连不上"。
		// 只有**这次运行里**创建的才复用:手机密钥不落盘,重启后拿不出明文,也就发不出新邀请。
		const reusable = [...this.devices.entries()].find(
			([id, device]) =>
				device.mobileSecret.length > 0 &&
				this.preferences.devices.find((entry) => entry.id === id)?.mobileIdentityKey === undefined,
		);
		if (reusable) {
			const [deviceId, device] = reusable;
			/**
			 * 复用的那台**要跟着改配对方式**:上一轮在局域网档生成、没被领取的二维码,
			 * 用户切到远程档再点一次生成 —— 那时二维码指向的是服务器上的中继,
			 * 记录里还写着"局域网"就会把它归错组(界面按这个分组)。
			 */
			const mode = this.mode();
			if (this.preferences.devices.find((entry) => entry.id === deviceId)?.mode !== mode) {
				this.preferences = await this.options.writePreferences((current) => ({
					...current,
					devices: current.devices.map((entry) => (entry.id === deviceId ? { ...entry, mode } : entry)),
				}));
			}
			const invite = await device.host.createInvite();
			this.invite = { deviceId, view: { ...invite, status: "ready" } };
			this.notify();
			return this.getState();
		}
		const deviceId = randomToken(24);
		const mobileSecret = randomToken(32);
		const relaySecret = randomToken(32);
		const record: RemotePairedDevice = {
			id: deviceId,
			name: "",
			createdAt: now,
			mobileSecretHash: sha256Hex(mobileSecret),
			// 记下**现在**是哪一档:手机随后连的就是这一档的中继(见 `RemoteAccessDeviceView.mode`)。
			mode: this.mode(),
		};
		this.preferences = await this.options.writePreferences((current) => ({
			...current,
			devices: [...current.devices, record],
		}));
		await this.options.secrets.put(`relay-secret-${deviceId}`, relaySecret);
		const host = this.createHost(record, mobileSecret, relaySecret, relayBaseUrl);
		this.devices.set(deviceId, { record, host, mobileSecret });
		if (this.preferences.enabled) {
			// 先把房间注册上(连上中继就是注册),邀请才可能被领取。
			this.startHost(deviceId, host);
		}
		try {
			const invite = await host.createInvite();
			this.invite = { deviceId, view: { ...invite, status: "ready" } };
		} catch (error) {
			this.invite = undefined;
			this.lastError = describe(error);
		}
		this.notify();
		return this.getState();
	}

	async withdrawInvite(): Promise<void> {
		const current = this.invite;
		if (!current) return;
		this.invite = undefined;
		await this.devices.get(current.deviceId)?.host.withdrawInvite().catch(() => undefined);
	}

	/** 撤销一台设备:停掉它的链路、删掉密钥与记录。丢手机时只作废那一台。 */
	async revokeDevice(deviceId: string): Promise<RemoteAccessState> {
		if (this.invite?.deviceId === deviceId) this.invite = undefined;
		const device = this.devices.get(deviceId);
		if (device) {
			await device.host.stop().catch(() => undefined);
			this.devices.delete(deviceId);
		}
		await this.options.secrets.remove(`relay-secret-${deviceId}`);
		this.preferences = await this.options.writePreferences((current) => ({
			...current,
			devices: current.devices.filter((entry) => entry.id !== deviceId),
		}));
		this.notify();
		return this.getState();
	}

	/**
	 * 一台设备接上来了 —— **首个领取者**在这里被钉住。
	 *
	 * 三件事一起做:把身份公钥写进设备记录(此后换身份的来者会被拒)、把名字补上(设备列表显示"谁在用")、
	 * 作废这次邀请(它是一次性的:用过就从界面与中继信箱上消失)。
	 */
	private async claimDevice(
		deviceId: string,
		device: { readonly identityKey: string; readonly deviceName?: string },
	): Promise<void> {
		const record = this.preferences.devices.find((entry) => entry.id === deviceId);
		if (record === undefined) return;
		const firstClaim = record.mobileIdentityKey === undefined;
		if (firstClaim || (device.deviceName !== undefined && record.name !== device.deviceName)) {
			this.preferences = await this.options.writePreferences((current) => ({
				...current,
				devices: current.devices.map((entry) =>
					entry.id === deviceId
						? {
								...entry,
								mobileIdentityKey: entry.mobileIdentityKey ?? device.identityKey,
								...(device.deviceName === undefined ? {} : { name: device.deviceName }),
								lastSeenAt: this.now(),
							}
						: entry,
				),
			}));
		}
		if (firstClaim && this.invite?.deviceId === deviceId) {
			// 邀请是一次性的:首个领取者用掉它就作废。
			this.invite = undefined;
			await this.devices.get(deviceId)?.host.withdrawInvite().catch(() => undefined);
		}
		this.options.onDeviceConnected?.({
			deviceId,
			name: this.preferences.devices.find((entry) => entry.id === deviceId)?.name ?? "",
		});
		this.notify();
	}

	/** 手机接上之后把名字补上(设备列表里显示"谁在用")。 */
	async renameDevice(deviceId: string, name: string): Promise<RemoteAccessState> {
		this.preferences = await this.options.writePreferences((current) => ({
			...current,
			devices: current.devices.map((device) => (device.id === deviceId ? { ...device, name } : device)),
		}));
		this.notify();
		return this.getState();
	}

	// ── 内部 ────────────────────────────────────────────────────────────────────

	private relayBaseUrl(): string | undefined {
		return this.preferences.relayBaseUrl ?? this.options.defaultRelayBaseUrl;
	}

	private async bringUpDevices(): Promise<void> {
		const relayBaseUrl = this.relayBaseUrl();
		if (relayBaseUrl === undefined) {
			this.lastError = "还没有配置中继地址。";
			return;
		}
		for (const record of this.preferences.devices) {
			if (this.devices.has(record.id)) continue;
			const relaySecret = await this.options.secrets.get(`relay-secret-${record.id}`);
			if (relaySecret === undefined) {
				// 密钥丢了(换机器、清了凭据库):这台设备需要重新配对,而不是拿一个错的密钥硬连。
				this.lastError = `设备 ${record.name || record.id.slice(0, 6)} 的密钥已丢失,需要重新配对。`;
				continue;
			}
			// 已配对设备的手机密钥只在领取时用到,重启后不再需要 —— 中继只认它的哈希。
			const host = this.createHost(record, "", relaySecret, relayBaseUrl);
			this.devices.set(record.id, { record, host, mobileSecret: "" });
			this.startHost(record.id, host);
		}
	}

	/**
	 * 拉起一台设备的链路,**只把真失败记成错误**。
	 *
	 * 关掉开关、换中继、撤销设备都会让正在等待的握手中断 —— 那些是**我们主动做的**,不是故障。
	 * 之前一视同仁地记录,结果是"关一下开关就冒出一条错误"(被一个测试抓到)。
	 */
	private startHost(deviceId: string, host: RemoteHostService): void {
		void host.start().catch((error: unknown) => {
			if (!this.preferences.enabled || !this.devices.has(deviceId)) return;
			this.lastError = describe(error);
			this.notify();
		});
	}

	private createHost(
		record: RemotePairedDevice,
		mobileSecret: string,
		relaySecret: string,
		relayBaseUrl: string,
	): RemoteHostService {
		return new RemoteHostService({
			surface: this.options.surface,
			deviceId: this.options.deviceId,
			deviceName: this.options.deviceName,
			identity: this.identity,
			pairingId: record.id,
			relaySecret,
			mobileSecretHash: record.mobileSecretHash,
			mobileSecret,
			relayBaseUrl,
			createTransport: this.options.createTransport,
			mailbox: this.options.mailbox,
			...(record.mobileIdentityKey === undefined
				? {}
				: { expectedPeerIdentityKey: decodePublicKey(record.mobileIdentityKey, "mobileIdentityKey") }),
			// 落库失败(磁盘满、凭据库锁住)不能变成一次未处理的 rejection:那会让"手机明明连上了"变成
			// 一条没人看见的报错。记下来,界面会显示。
			onStateChanged: () => this.notify(),
			onDeviceConnected: (device) =>
				void this.claimDevice(record.id, device).catch((error: unknown) => {
					this.lastError = describe(error);
					this.notify();
				}),
			...(this.options.logger === undefined ? {} : { logger: this.options.logger }),
			...(this.options.now === undefined ? {} : { now: this.options.now }),
			...(this.options.inviteTtlMs === undefined ? {} : { inviteTtlMs: this.options.inviteTtlMs }),
		});
	}

	private now(): number {
		return this.options.now?.() ?? Date.now();
	}

	private notify(): void {
		for (const listener of this.listeners) listener();
	}
}

function describe(error: unknown): string {
	if (!(error instanceof Error)) {
		// 非 Error 的抛出以前会退化成一句无信息量的兜底。把类型与形状说出来,至少能定位。
		let shape: string;
		try {
			shape = JSON.stringify(error)?.slice(0, 200) ?? String(error);
		} catch {
			shape = String(error);
		}
		return `远程访问启动失败(${typeof error}: ${shape})`;
	}
	// 启动失败几乎都是"连不上中继":把这条可能性说出来,用户才知道该去查地址还是查隧道。
	return error.message.includes("中继") || error.message.includes("WebSocket")
		? error.message
		: `连不上中继:${error.message}`;
}
