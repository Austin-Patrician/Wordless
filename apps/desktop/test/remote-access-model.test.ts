import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RemoteAccessState } from "@wordless/protocol";
import { remoteAccessViewModel, webClientUrl } from "../src/renderer/features/settings/remote-access-model.ts";

/**
 * 远程连接面板的"显示什么"判断。
 *
 * 这里钉住的是**别骗用户**:二维码只在真的能用时出现、过期要说清楚、设备名缺失要说成"待连接",
 * 而不是显示一片空白让人以为坏了。
 */

const NOW = 1_700_000_000_000;

const state = (overrides: Partial<RemoteAccessState> = {}): RemoteAccessState => ({
  enabled: true,
  connection: "connecting",
  devices: [],
  relayBaseUrl: "wss://relay.example",
  ...overrides,
});

describe("状态行", () => {
  it("三种连接状态各有自己的说法,不只靠颜色", () => {
    assert.equal(remoteAccessViewModel(state({ connection: "off" }), NOW).statusKey, "remoteAccessStatusOff");
    assert.equal(remoteAccessViewModel(state({ connection: "connecting" }), NOW).statusKey, "remoteAccessStatusConnecting");
    assert.equal(remoteAccessViewModel(state({ connection: "online" }), NOW).statusKey, "remoteAccessStatusOnline");
  });

  it("在线是 ok,连接中是 working,出错是 attention", () => {
    assert.equal(remoteAccessViewModel(state({ connection: "online" }), NOW).tone, "ok");
    assert.equal(remoteAccessViewModel(state({ connection: "connecting" }), NOW).tone, "working");
    assert.equal(remoteAccessViewModel(state({ connection: "off", error: "坏了" }), NOW).tone, "attention");
  });
});

describe("二维码", () => {
  const invite = (status: "ready" | "failed") => ({
    pairingId: "p1",
    code: "K7Q29MXD",
    formattedCode: "K7Q2-9MXD",
    password: "123456",
    qrText: "WORDLESS://PAIR/K7Q29MXD/123456",
    expiresAt: NOW + 5 * 60_000,
    status,
  });

  it("邀请放上中继之后才显示二维码", () => {
    const ready = remoteAccessViewModel(state({ invite: invite("ready") }), NOW);
    assert.equal(ready.qrText, "WORDLESS://PAIR/K7Q29MXD/123456");
  });

  it("还没放上(或放失败)时不显示二维码 —— 否则它会在手机镜头下变化", () => {
    assert.equal(remoteAccessViewModel(state({ invite: invite("failed") }), NOW).qrText, undefined);
  });

  it("没有邀请时既没有二维码也没有连接码", () => {
    const view = remoteAccessViewModel(state(), NOW);
    assert.equal(view.qrText, undefined);
    assert.equal(view.code, undefined);
    assert.equal(view.inviteExpired, false);
  });

  it("连接码按展示样式给出,并带上剩余时间", () => {
    const view = remoteAccessViewModel(state({ invite: invite("ready") }), NOW);
    assert.equal(view.code, "K7Q2-9MXD");
    assert.equal(view.password, "123456");
    assert.equal(view.inviteMinutesLeft, 5);
    assert.equal(view.inviteExpired, false);
  });

  it("过期之后明确说已过期(而不是显示 0 分钟还在那儿)", () => {
    const expired = remoteAccessViewModel(state({ invite: invite("ready") }), NOW + 10 * 60_000);
    assert.equal(expired.inviteMinutesLeft, 0);
    assert.equal(expired.inviteExpired, true);
  });
});

describe("设备列表", () => {
  it("没连过的设备标成待连接,而不是空名字", () => {
    const view = remoteAccessViewModel(
      state({ devices: [{ id: "d1", name: "", createdAt: 1, online: false, paired: false }] }),
      NOW,
    );
    assert.equal(view.devices[0].unnamed, true);
    assert.equal(view.devices[0].name, "");
  });

  it("连过的设备带名字与在线状态", () => {
    const view = remoteAccessViewModel(
      state({ devices: [{ id: "d1", name: "我的手机", createdAt: 1, lastSeenAt: 2, online: true, paired: true }] }),
      NOW,
    );
    assert.equal(view.devices[0].unnamed, false);
    assert.equal(view.devices[0].online, true);
    assert.equal(view.devices[0].lastSeenAt, 2);
  });
});

describe("中继地址", () => {
  it("自定义地址与默认地址都带出来(界面据此决定要不要显示'恢复默认')", () => {
    const view = remoteAccessViewModel(
      state({ relayBaseUrl: "wss://relay.example", defaultRelayBaseUrl: "wss://default.example" }),
      NOW,
    );
    assert.equal(view.relayBaseUrl, "wss://relay.example");
    assert.equal(view.defaultRelayBaseUrl, "wss://default.example");
  });

  it("没有默认中继的构建不带这个字段", () => {
    assert.equal(remoteAccessViewModel(state(), NOW).defaultRelayBaseUrl, undefined);
  });

describe("等待配对 ≠ 不在线", () => {
  const device = (overrides: Record<string, unknown> = {}) => ({
    id: "d1",
    name: "",
    createdAt: 1,
    online: false,
    paired: false,
    ...overrides,
  });

  it("二维码刚生成、还没人来扫:标成未配对", () => {
    const view = remoteAccessViewModel(state({ devices: [device()] }) as never, 1_000);
    assert.equal(view.devices[0].paired, false);
    assert.equal(view.devices[0].online, false);
  });

  it("领取过之后就标成已配对", () => {
    const view = remoteAccessViewModel(state({ devices: [device({ paired: true, online: true })] }) as never, 1_000);
    assert.equal(view.devices[0].paired, true);
    assert.equal(view.devices[0].online, true);
  });

  it("有已配对设备时才给出免二维码的地址", () => {
    const paired = remoteAccessViewModel(state({ devices: [device({ paired: true })] }) as never, 1_000);
    assert.equal(paired.quickConnectUrl, "https://relay.example");
    const waiting = remoteAccessViewModel(state({ devices: [device()] }) as never, 1_000);
    assert.equal(waiting.quickConnectUrl, undefined, "还没配对过的人不需要看到这个地址");
    const none = remoteAccessViewModel(state({ devices: [] }) as never, 1_000);
    assert.equal(none.quickConnectUrl, undefined);
  });

  it("地址换算与主进程同一套规则(ws→http、wss→https、去掉尾斜杠)", () => {
    assert.equal(webClientUrl("ws://192.168.1.109:8787"), "http://192.168.1.109:8787");
    assert.equal(webClientUrl("wss://relay.example/"), "https://relay.example");
    assert.equal(webClientUrl("https://relay.example"), "https://relay.example");
    assert.equal(webClientUrl(undefined), undefined);
    assert.equal(webClientUrl("   "), undefined);
  });
});
});
