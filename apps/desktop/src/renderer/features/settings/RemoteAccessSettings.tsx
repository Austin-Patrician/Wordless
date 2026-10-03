import type { RemoteAccessState } from "@wordless/protocol";
import { Button, Switch } from "@wordless/ui-kit";
import { AlertTriangle, Check, Copy, Loader2, QrCode, RefreshCw, Smartphone, Unlink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import { remoteAccessViewModel } from "./remote-access-model";

/**
 * 设置 → 远程连接。
 *
 * 这里回答两件事:**怎么让手机连上来**(连接码 + 二维码),以及**谁已经连上了**(设备列表与解除配对)。
 *
 * 界面上的几条取舍:
 * - **状态不只靠颜色**:状态行有图标 + 文字,颜色只是辅助。
 * - **一屏一个主按钮**:没有邀请时"生成二维码"是主按钮;有邀请时它退成"刷新",主按钮让给"解除配对"
 *   这类破坏性动作以外的东西 —— 破坏性动作永远是描边/幽灵样式,不抢主按钮。
 * - **二维码只在真的能用时出现**:邀请还没放上中继时不画二维码(否则它会在手机镜头下变化)。
 * - **错误可被读出来**:`role="status"` + 明确的恢复动作。
 * - **复制按钮给反馈**:复制后图标变勾并短暂停留,而不是弹一个 toast。
 */
export function RemoteAccessSettings() {
  const { t } = usePreferences();
  const client = useRuntimeClient();
  const [state, setState] = useState<RemoteAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [relayDraft, setRelayDraft] = useState("");
  const [copied, setCopied] = useState<"code" | "password" | "quick" | null>(null);
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<{ ok: boolean; detail: string } | null>(null);

  const apply = useCallback((next: RemoteAccessState) => {
    setState(next);
    setRelayDraft(next.relayBaseUrl ?? "");
  }, []);

  /**
   * 文案通过 ref 取最新的一份,**不进依赖**。
   *
   * 原因是 `t` 不一定有稳定引用(取决于实现/测试替身):把它放进依赖,`run` 就每次渲染都变,
   * 进而让下面那个 `useEffect` 每次渲染都跑一次 → 无限循环(这个 bug 是被一个超时的浏览器测试抓出来的)。
   */
  const translate = useRef(t);
  translate.current = t;

  const run = useCallback(
    async (action: () => Promise<RemoteAccessState>) => {
      setBusy(true);
      setError(null);
      try {
        apply(await action());
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : translate.current("remoteAccessError"));
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  useEffect(() => {
    void run(() => client.getRemoteAccessState());
  }, [client, run]);

  /**
   * 订阅主进程的状态推送。
   *
   * **这是这个页面能"自己更新"的唯一来源**:手机扫码连上、二维码被领取、设备掉线,都只发生在
   * 主进程里。之前只取一次状态,于是用户看到设备一直"不在线"、二维码一直挂着 —— 而实际上早就配好了。
   */
  useEffect(() => {
    const subscribe = client.onRemoteAccessChanged;
    // 测试替身不一定实现了它(部分 mock):没有就安静地退化成"只在打开时取一次"。
    if (typeof subscribe !== "function") return;
    return subscribe((next) => {
      setState(next);
      setRelayDraft(next.relayBaseUrl ?? "");
    });
  }, [client]);

  const view = useMemo(() => (state === null ? null : remoteAccessViewModel(state, Date.now())), [state]);

  const copy = useCallback(async (kind: "code" | "password" | "quick", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1_500);
    } catch {
      // 剪贴板不可用(权限/无焦点)不是错误:用户还能自己看、自己敲。
    }
  }, []);

  if (view === null) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
        <div className="mx-auto max-w-[780px] space-y-4">
          <p className="flex items-center gap-2 text-[12px] text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
            {t("remoteAccessLoading")}
          </p>
          {/* 读不到状态时不能一直转圈:把失败说出来,用户才知道该重开设置还是重开应用。 */}
          {error === null ? null : (
            <p className="flex items-start gap-2 rounded-2xl bg-muted px-4 py-3 text-[12px] leading-5 text-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    // 滚动容器与内边距由**页面自己**提供:设置对话框只负责外框,不替页面滚动。
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
      <div className="mx-auto max-w-[780px] space-y-4">
      {/* 开关与状态 */}
      <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-[#cfd9b8] bg-[#f5f8eb] text-[#60753a] dark:border-[#53663a] dark:bg-[#303b1d] dark:text-[#d7efa5]">
              <Smartphone aria-hidden="true" className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold">{t("remoteAccessTitle")}</h2>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteAccessDescription")}</p>
            </div>
          </div>
          <Switch
            checked={view.enabled}
            disabled={busy}
            aria-label={t("remoteAccessTitle")}
            onCheckedChange={(enabled) => void run(() => client.setRemoteAccessEnabled(enabled))}
          />
        </div>

        <p
          className="mt-3 flex items-center gap-2 pl-11 text-[11px] leading-4 text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {view.tone === "ok" ? (
            <Check className="size-3.5 text-accent-foreground" />
          ) : view.tone === "attention" ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none" />
          )}
          {t(view.statusKey)}
        </p>
      </section>

      {/* 配对:连接码 + 二维码 */}
      {view.enabled ? (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <h2 className="text-[14px] font-semibold">{t("remoteAccessPairingTitle")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteAccessPairingHint")}</p>

          {view.qrText === undefined ? (
            <div className="mt-3 space-y-3">
              {view.code !== undefined ? (
                <p className="text-[11px] leading-4 text-muted-foreground">{t("remoteAccessCodePreparing")}</p>
              ) : null}
              <Button
                disabled={busy || view.relayBaseUrl === undefined}
                onClick={() => void run(() => client.createRemoteInvite())}
              >
                {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <QrCode className="size-4" />}
                {t("remoteAccessGenerate")}
              </Button>
              {view.relayBaseUrl === undefined ? (
                <p className="text-[11px] leading-4 text-muted-foreground">{t("remoteAccessRelayRequired")}</p>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="w-fit rounded-[7px] bg-white p-2 dark:bg-[#1c1d18]">
                {/* 二维码里只有连接码与密码:真凭据加密后放在中继上,扫到码的人也需要密码。 */}
                <QRCodeSVG value={view.qrText} size={148} level="H" marginSize={0} aria-label={t("remoteAccessQrAlt")} />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <Field
                  label={t("remoteAccessCode")}
                  value={view.code ?? ""}
                  copied={copied === "code"}
                  onCopy={() => void copy("code", view.code ?? "")}
                  copyLabel={t("remoteAccessCopy")}
                  copiedLabel={t("remoteAccessCopied")}
                />
                <Field
                  label={t("remoteAccessPassword")}
                  value={view.password ?? ""}
                  copied={copied === "password"}
                  onCopy={() => void copy("password", view.password ?? "")}
                  copyLabel={t("remoteAccessCopy")}
                  copiedLabel={t("remoteAccessCopied")}
                />
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {view.inviteExpired
                    ? t("remoteAccessExpired")
                    : t("remoteAccessExpiresIn").replace("{minutes}", String(view.inviteMinutesLeft ?? 0))}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => client.createRemoteInvite())}
                  >
                    <RefreshCw className="size-4" />
                    {t("remoteAccessRefresh")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(() => client.withdrawRemoteInvite())}
                  >
                    {t("remoteAccessWithdraw")}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* 已配对的设备 */}
      <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
        <h2 className="text-[14px] font-semibold">{t("remoteAccessDevicesTitle")}</h2>
        {view.devices.length === 0 ? (
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{t("remoteAccessNoDevices")}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {view.devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <Smartphone className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">
                    {device.unnamed ? t("remoteAccessDeviceUnnamed") : device.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {!device.paired
                      ? t("remoteAccessDeviceWaiting")
                      : device.online
                        ? t("remoteAccessDeviceOnline")
                        : t("remoteAccessDeviceOffline")}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(() => client.revokeRemoteDevice(device.id))}
                >
                  <Unlink className="size-3.5" />
                  {t("remoteAccessRevoke")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[11px] leading-4 text-muted-foreground">{t("remoteAccessRevokeHint")}</p>
      </section>

      {/*
        已配对的设备**不需要再扫码** —— 这条以前只存在于代码里,界面上没有任何地方说过,
        于是用户想再连一次时只能再生成一个二维码,还因此多出一台重复设备。
      */}
      {view.enabled && view.quickConnectUrl !== undefined ? (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#24261c]">
          <h2 className="text-[14px] font-semibold">{t("remoteAccessQuickConnectTitle")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteAccessQuickConnectHint")}</p>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="w-fit rounded-[7px] bg-white p-2 dark:bg-[#1c1d18]">
              <QRCodeSVG
                value={view.quickConnectUrl}
                size={120}
                level="H"
                marginSize={0}
                aria-label={t("remoteAccessQuickConnectQrAlt")}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-3">
              <Field
                label={t("remoteAccessQuickConnectUrl")}
                value={view.quickConnectUrl}
                copied={copied === "quick"}
                onCopy={() => void copy("quick", view.quickConnectUrl ?? "")}
                copyLabel={t("remoteAccessCopy")}
                copiedLabel={t("remoteAccessCopied")}
              />
              <p className="text-[11px] leading-4 text-muted-foreground">{t("remoteAccessQuickConnectNote")}</p>
            </div>
          </div>
        </section>
      ) : null}

      {/* 中继地址 */}
      {view.enabled ? (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <h2 className="text-[14px] font-semibold">{t("remoteAccessRelayTitle")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteAccessRelayHint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={relayDraft}
              onChange={(event) => setRelayDraft(event.target.value)}
              placeholder={view.defaultRelayBaseUrl ?? "wss://relay.example"}
              spellCheck={false}
              className="h-9 min-w-[240px] flex-1 rounded-[7px] border border-input bg-white px-3 font-mono text-[12px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:bg-[#1c1d18]"
            />
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => client.setRemoteRelayUrl(relayDraft.trim().length === 0 ? undefined : relayDraft.trim()))}
            >
              {t("remoteAccessSave")}
            </Button>
            {/* 生成二维码之前就能知道地址通不通 —— 否则用户会先看到一句连接失败的报错。 */}
            <Button
              variant="ghost"
              disabled={busy || probing}
              onClick={() => {
                setProbing(true);
                setProbe(null);
                void client
                  .testRemoteRelay(relayDraft.trim().length === 0 ? undefined : relayDraft.trim())
                  .then(setProbe)
                  .catch((failure: unknown) =>
                    setProbe({ ok: false, detail: failure instanceof Error ? failure.message : t("remoteAccessError") }),
                  )
                  .finally(() => setProbing(false));
              }}
            >
              {probing ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
              {probing ? t("remoteAccessTesting") : t("remoteAccessTestRelay")}
            </Button>
            {view.defaultRelayBaseUrl !== undefined ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => client.setRemoteRelayUrl(undefined))}
              >
                {t("remoteAccessRestoreDefault")}
              </Button>
            ) : null}
          </div>
          {probe === null ? null : (
            <p
              className="mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {probe.ok ? (
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent-foreground" />
              ) : (
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              )}
              {probe.detail}
            </p>
          )}
        </section>
      ) : null}

      {(error ?? view.error) !== undefined ? (
        <p
          className="flex items-start gap-2 rounded-2xl bg-muted px-4 py-3 text-[12px] leading-5 text-foreground"
          role="status"
          aria-live="polite"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          {error ?? view.error}
        </p>
      ) : null}
      </div>
    </div>
  );
}

/** 连接码/密码:等宽显示 + 复制按钮(复制后变勾)。 */
function Field({
  label,
  value,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  readonly label: string;
  readonly value: string;
  readonly copied: boolean;
  readonly copyLabel: string;
  readonly copiedLabel: string;
  readonly onCopy: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <code className="flex-1 rounded-[7px] bg-white px-2.5 py-1.5 font-mono text-[13px] tracking-[0.18em] text-foreground dark:bg-[#1c1d18]">
        {value}
      </code>
      <Button variant="ghost" size="sm" onClick={onCopy} aria-label={copied ? copiedLabel : copyLabel}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}
