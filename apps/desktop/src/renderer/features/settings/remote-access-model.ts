import type { RemoteAccessState } from "@wordless/protocol";
import type { MessageKey } from "../../shared/i18n";

/**
 * 把远程访问的状态翻成"面板要显示什么"。
 *
 * 抽成纯函数是为了让它可测(不必起 React),而且**只有这一处**决定"什么时候显示二维码、
 * 什么时候说'还在准备'" —— 面板与将来的导览页读同一份判断,不会出现两处说法不一致。
 *
 * 这里只产出**结构与 i18n 键**,不产出文案:文案在 `i18n.ts` 里,两处都能改。
 */

export type RemoteAccessTone = "ok" | "working" | "attention";

export interface RemoteAccessDeviceRow {
  readonly id: string;
  /** 空字符串表示还没连过 —— 界面据此显示"待连接的设备"。 */
  readonly name: string;
  readonly unnamed: boolean;
  readonly online: boolean;
  /**
   * 已经有手机领取过这次配对。
   *
   * `false` 时**不能显示"不在线"**:那台设备只是"二维码发出去了,还没人来扫",
   * 说它不在线会让用户以为自己的手机连不上。
   */
  readonly paired: boolean;
  readonly lastSeenAt?: number;
}

/**
 * 已配对设备**按接入方式分组**。
 *
 * 混在一张列表里用户分不出哪台是哪台 —— 而这两类设备的行为根本不同:
 * 局域网配对的那台只在同一个 WiFi 里能连上,远程配对的那台在哪都行。
 * 组里带上 `current`:当前档位那一组在最上面,另一组会说明"要切回去才能连它"。
 */
export interface RemoteAccessDeviceGroup {
  /** `unknown` = 早先配对的、当时没记下方式(老数据)—— 单独一组,不猜。 */
  readonly mode: "lan" | "remote" | "unknown";
  readonly labelKey: MessageKey;
  /** 是不是**当前档位**的那一组(界面据此说明为什么另一组连不上)。 */
  readonly current: boolean;
  readonly devices: readonly RemoteAccessDeviceRow[];
}

/**
 * 手机该打开哪个地址。
 *
 * 中继与网页同域,所以 `ws(s)://` 换成 `http(s)://` 就是网页地址 —— 与主进程里
 * `webBaseUrl` 同一套规则(两处必须一致,否则用户照着抄的地址打不开)。
 */
export function webClientUrl(relayBaseUrl: string | undefined): string | undefined {
  if (relayBaseUrl === undefined || relayBaseUrl.trim().length === 0) return undefined;
  return relayBaseUrl.trim().replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

/** 局域网模式:面板要显示什么。 */
export interface RemoteLanAddressRow {
  readonly address: string;
  readonly name: string;
  readonly selected: boolean;
}

export interface RemoteLanView {
  readonly running: boolean;
  readonly port?: number;
  readonly addresses: readonly RemoteLanAddressRow[];
  /** 手机该打开的那个地址(服务在跑时才有)。 */
  readonly phoneUrl?: string;
  /** 网页客户端的构建产物就绪吗。没就绪时界面要说"为什么还不能用"。 */
  readonly webClientReady: boolean;
  /** 端口被占用、自动换了一个(界面要把这件事说出来)。 */
  readonly portChanged: boolean;
  readonly error?: string;
}

export interface RemoteAccessViewModel {
  readonly enabled: boolean;
  /**
   * 当前接入方式。
   *
   * 旧版本的本机没有这个字段:按"有没有局域网能力"退化成局域网,否则远程 ——
   * 界面据此决定显示哪一档,而不是显示一个点不动的切换。
   */
  readonly mode: "lan" | "remote";
  readonly tone: RemoteAccessTone;
  readonly statusKey: MessageKey;
  /**
   * 二维码里装什么。
   *
   * **只在邀请确实放上中继之后才给**(`status === "ready"`):否则二维码要么在手机镜头下变化,
   * 要么指向一个还取不到的东西。没放上时不显示二维码,由界面引导用户用连接码。
   */
  readonly qrText?: string;
  /** 连接码与密码:没有摄像头、或手机与电脑不在一处时用。 */
  readonly code?: string;
  readonly password?: string;
  /** 邀请还剩几分钟;已过期是 0。 */
  readonly inviteMinutesLeft?: number;
  readonly inviteExpired: boolean;
  readonly devices: readonly RemoteAccessDeviceRow[];
  /**
   * 设备按接入方式分好组(当前档位那一组在最前面)。
   *
   * `devices` 仍然给"有没有配对过的设备"这类判断用(比如免扫码地址要不要显示),
   * 界面渲染的是这一份。
   */
  readonly deviceGroups: readonly RemoteAccessDeviceGroup[];
  /**
   * 已经配过对的设备该打开的地址。
   *
   * 有它就说明"下次不用再扫码" —— 手机上打开这个地址,凭本机存的凭据自己就连上了。
   * 没有已配对设备时不显示(对还没配对的人,这句话只会让人困惑)。
   */
  readonly quickConnectUrl?: string;
  /** 当前用的中继;undefined 表示这份构建没有默认中继。 */
  readonly relayBaseUrl?: string;
  readonly defaultRelayBaseUrl?: string;
  readonly error?: string;
  /** 局域网那一档;undefined = 这份构建没有局域网能力(旧版本的本机),界面不显示这一档。 */
  readonly lan?: RemoteLanView;
}

const DEVICE_GROUP_LABELS: Record<RemoteAccessDeviceGroup["mode"], MessageKey> = {
  lan: "remoteAccessDevicesLanGroup",
  remote: "remoteAccessDevicesRemoteGroup",
  unknown: "remoteAccessDevicesUnknownGroup",
};

function deviceRow(device: RemoteAccessState["devices"][number]): RemoteAccessDeviceRow {
  return {
    id: device.id,
    name: device.name,
    unnamed: device.name.trim().length === 0,
    online: device.online,
    paired: device.paired,
    ...(device.lastSeenAt === undefined ? {} : { lastSeenAt: device.lastSeenAt }),
  };
}

/**
 * 分组,顺序是**当前档位在最前面**(那是用户现在能用的那一组),然后是另一档,最后是没记下方式的。
 *
 * 空组**不出现**:没在局域网下配过对的人不该看到一行"局域网配对的(0)"。
 * 拼错/未知的 `mode` 一律当"没记下"(不猜) —— 猜错比不分组更糟。
 */
function deviceGroups(
  devices: RemoteAccessState["devices"],
  mode: "lan" | "remote",
): RemoteAccessDeviceGroup[] {
  const buckets: Record<RemoteAccessDeviceGroup["mode"], RemoteAccessDeviceRow[]> = {
    lan: [],
    remote: [],
    unknown: [],
  };
  for (const device of devices) {
    const key = device.mode === "lan" || device.mode === "remote" ? device.mode : "unknown";
    buckets[key].push(deviceRow(device));
  }
  const order: RemoteAccessDeviceGroup["mode"][] =
    mode === "lan" ? ["lan", "remote", "unknown"] : ["remote", "lan", "unknown"];
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ mode: key, labelKey: DEVICE_GROUP_LABELS[key], current: key === mode, devices: buckets[key] }));
}

const STATUS_KEYS: Record<RemoteAccessState["connection"], MessageKey> = {
  off: "remoteAccessStatusOff",
  connecting: "remoteAccessStatusConnecting",
  online: "remoteAccessStatusOnline",
};

export function remoteAccessViewModel(state: RemoteAccessState, now: number): RemoteAccessViewModel {
  const invite = state.invite;
  const minutesLeft = invite === undefined ? undefined : Math.max(0, Math.ceil((invite.expiresAt - now) / 60_000));
  // 老数据没有 `mode`:按"有没有局域网能力"推(与主进程同一套规则,否则界面和实际会分叉)。
  const mode = state.mode ?? (state.lan === undefined ? "remote" : "lan");
  return {
    enabled: state.enabled,
    mode,
    tone: state.error !== undefined ? "attention" : state.connection === "online" ? "ok" : "working",
    statusKey: STATUS_KEYS[state.connection],
    ...(invite === undefined || invite.status !== "ready" ? {} : { qrText: invite.qrText }),
    ...(invite === undefined ? {} : { code: invite.formattedCode, password: invite.password }),
    ...(minutesLeft === undefined ? {} : { inviteMinutesLeft: minutesLeft }),
    inviteExpired: minutesLeft === 0,
    devices: state.devices.map(deviceRow),
    deviceGroups: deviceGroups(state.devices, mode),
    ...(() => {
      const url = webClientUrl(state.relayBaseUrl ?? state.defaultRelayBaseUrl);
      const anyPaired = state.devices.some((device) => device.paired);
      return url === undefined || !anyPaired ? {} : { quickConnectUrl: url };
    })(),
    ...(state.relayBaseUrl === undefined ? {} : { relayBaseUrl: state.relayBaseUrl }),
    ...(state.defaultRelayBaseUrl === undefined ? {} : { defaultRelayBaseUrl: state.defaultRelayBaseUrl }),
    ...(state.error === undefined ? {} : { error: state.error }),
    ...(state.lan === undefined ? {} : { lan: lanView(state.lan) }),
  };
}

/**
 * 局域网状态 → 面板要显示的东西。
 *
 * 关键是**手机该打开哪个地址**:它不是从中继地址推出来的(中继地址是桌面端自己连的那个),
 * 而是"选中的网卡 + 端口"。算错这一处,二维码指向的地址手机打不开,而界面看起来一切正常。
 */
function lanView(lan: RemoteAccessState["lan"] & object): RemoteLanView {
  const selected = lan.selectedAddress ?? lan.addresses[0]?.address;
  return {
    running: lan.running,
    ...(lan.port === undefined ? {} : { port: lan.port }),
    addresses: lan.addresses.map((entry) => ({
      address: entry.address,
      name: entry.name,
      selected: entry.address === selected,
    })),
    ...(lan.running && selected !== undefined && lan.port !== undefined
      ? { phoneUrl: `http://${selected}:${lan.port}` }
      : {}),
    webClientReady: lan.webClientReady,
    portChanged: lan.portChanged === true,
    ...(lan.error === undefined ? {} : { error: lan.error }),
  };
}
