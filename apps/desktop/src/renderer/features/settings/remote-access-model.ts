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
 * 手机该打开哪个地址。
 *
 * 中继与网页同域,所以 `ws(s)://` 换成 `http(s)://` 就是网页地址 —— 与主进程里
 * `webBaseUrl` 同一套规则(两处必须一致,否则用户照着抄的地址打不开)。
 */
export function webClientUrl(relayBaseUrl: string | undefined): string | undefined {
  if (relayBaseUrl === undefined || relayBaseUrl.trim().length === 0) return undefined;
  return relayBaseUrl.trim().replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
}

export interface RemoteAccessViewModel {
  readonly enabled: boolean;
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
}

const STATUS_KEYS: Record<RemoteAccessState["connection"], MessageKey> = {
  off: "remoteAccessStatusOff",
  connecting: "remoteAccessStatusConnecting",
  online: "remoteAccessStatusOnline",
};

export function remoteAccessViewModel(state: RemoteAccessState, now: number): RemoteAccessViewModel {
  const invite = state.invite;
  const minutesLeft = invite === undefined ? undefined : Math.max(0, Math.ceil((invite.expiresAt - now) / 60_000));
  return {
    enabled: state.enabled,
    tone: state.error !== undefined ? "attention" : state.connection === "online" ? "ok" : "working",
    statusKey: STATUS_KEYS[state.connection],
    ...(invite === undefined || invite.status !== "ready" ? {} : { qrText: invite.qrText }),
    ...(invite === undefined ? {} : { code: invite.formattedCode, password: invite.password }),
    ...(minutesLeft === undefined ? {} : { inviteMinutesLeft: minutesLeft }),
    inviteExpired: minutesLeft === 0,
    devices: state.devices.map((device) => ({
      id: device.id,
      name: device.name,
      unnamed: device.name.trim().length === 0,
      online: device.online,
      paired: device.paired,
      ...(device.lastSeenAt === undefined ? {} : { lastSeenAt: device.lastSeenAt }),
    })),
    ...(() => {
      const url = webClientUrl(state.relayBaseUrl ?? state.defaultRelayBaseUrl);
      const anyPaired = state.devices.some((device) => device.paired);
      return url === undefined || !anyPaired ? {} : { quickConnectUrl: url };
    })(),
    ...(state.relayBaseUrl === undefined ? {} : { relayBaseUrl: state.relayBaseUrl }),
    ...(state.defaultRelayBaseUrl === undefined ? {} : { defaultRelayBaseUrl: state.defaultRelayBaseUrl }),
    ...(state.error === undefined ? {} : { error: state.error }),
  };
}
