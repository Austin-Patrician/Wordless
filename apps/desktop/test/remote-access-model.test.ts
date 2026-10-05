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

  it("**按配对方式分组**:局域网一台、远程一台,分成两组", () => {
    // 混在一张列表里用户分不出哪台是哪台(真实反馈):局域网那台只在同一个 WiFi 里能连上。
    const view = remoteAccessViewModel(
      state({
        mode: "remote",
        devices: [
          { id: "lan-1", name: "家里的手机", createdAt: 1, online: false, paired: true, mode: "lan" },
          { id: "remote-1", name: "出差的手机", createdAt: 2, online: true, paired: true, mode: "remote" },
        ],
      }),
      NOW,
    );
    assert.deepEqual(
      view.deviceGroups.map((group) => [group.mode, group.devices.length, group.current]),
      [
        // **当前档位那一组在最前面**(那是现在能用的那一组)。
        ["remote", 1, true],
        ["lan", 1, false],
      ],
    );
    assert.deepEqual(
      view.deviceGroups.map((group) => group.devices.map((device) => device.name)),
      [["出差的手机"], ["家里的手机"]],
    );
  });

  it("局域网档下:顺序反过来(局域网那组在前)", () => {
    const view = remoteAccessViewModel(
      state({
        mode: "lan",
        devices: [
          { id: "remote-1", name: "出差的手机", createdAt: 2, online: false, paired: true, mode: "remote" },
          { id: "lan-1", name: "家里的手机", createdAt: 1, online: true, paired: true, mode: "lan" },
        ],
      }),
      NOW,
    );
    assert.deepEqual(
      view.deviceGroups.map((group) => [group.mode, group.current]),
      [
        ["lan", true],
        ["remote", false],
      ],
    );
  });

  it("没记下方式的(老数据)单独一组 —— **不猜**", () => {
    const view = remoteAccessViewModel(
      state({
        mode: "remote",
        devices: [{ id: "old-1", name: "旧手机", createdAt: 1, online: false, paired: true }],
      }),
      NOW,
    );
    assert.deepEqual(
      view.deviceGroups.map((group) => [group.mode, group.current]),
      [["unknown", false]],
    );
    // 拼错的值也当"没记下",而不是归到某一组里(猜错比不分组更糟)。
    const bogus = remoteAccessViewModel(
      state({
        mode: "remote",
        devices: [{ id: "x", name: "", createdAt: 1, online: false, paired: true, mode: "banana" as never }],
      }),
      NOW,
    );
    assert.equal(bogus.deviceGroups[0]?.mode, "unknown");
  });

  it("空组**不出现**:没在局域网下配过对的人不该看到「局域网配对的(0)」", () => {
    const view = remoteAccessViewModel(
      state({ mode: "remote", devices: [{ id: "d1", name: "", createdAt: 1, online: false, paired: true, mode: "remote" }] }),
      NOW,
    );
    assert.deepEqual(
      view.deviceGroups.map((group) => group.mode),
      ["remote"],
    );
  });

  it("没有设备时:没有分组(界面显示「还没配对过」)", () => {
    assert.deepEqual(remoteAccessViewModel(state({ devices: [] }), NOW).deviceGroups, []);
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

  it("局域网:手机要打开的地址由**选中的网卡 + 端口**算出来", () => {
    // 这一处算错的表现是"二维码指向的地址手机打不开,而界面看起来一切正常"。
    const view = remoteAccessViewModel(
      {
        enabled: true,
        connection: "off",
        devices: [],
        lan: {
          running: true,
          port: 8787,
          addresses: [
            { address: "192.168.1.9", name: "en0" },
            { address: "10.8.0.2", name: "utun3" },
          ],
          selectedAddress: "10.8.0.2",
          webClientReady: true,
        },
      },
      1,
    );
    assert.equal(view.lan?.phoneUrl, "http://10.8.0.2:8787");
    assert.deepEqual(
      view.lan?.addresses.map((entry) => [entry.address, entry.selected]),
      [
        ["192.168.1.9", false],
        ["10.8.0.2", true],
      ],
    );
  });

  it("局域网:没选过就用第一个;没跑起来就不给地址", () => {
    const notStarted = remoteAccessViewModel(
      {
        enabled: false,
        connection: "off",
        devices: [],
        lan: {
          running: false,
          addresses: [{ address: "192.168.1.9", name: "en0" }],
          webClientReady: false,
          error: "这台机器上还没有网页客户端(开发版需要先构建一次)。",
        },
      },
      1,
    );
    assert.equal(notStarted.lan?.phoneUrl, undefined, "没跑起来就不该给地址");
    assert.match(notStarted.lan?.error ?? "", /网页客户端/);
    assert.equal(notStarted.lan?.addresses[0]?.selected, true, "没选过时第一个算选中");
  });

  it("旧版本的本机没有局域网能力:这一档整个不出现,模式退化成远程", () => {
    const view = remoteAccessViewModel({ enabled: false, connection: "off", devices: [] }, 1);
    assert.equal(view.lan, undefined);
    // 没有 `mode` 字段的旧本机:按"有没有局域网能力"退化 —— 界面据此决定显示哪一档。
    assert.equal(view.mode, "remote");
  });

  it("新本机:模式按状态里的值走", () => {
    const view = remoteAccessViewModel({ enabled: false, connection: "off", devices: [], mode: "lan" }, 1);
    assert.equal(view.mode, "lan");
  });
});
