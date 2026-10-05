import type { RemoteAccessState } from "@wordless/protocol";
import type { DeployProbeFacts, RemoteUninstallPlan } from "../../../bridge/desktop-bridge";
import { Button, Switch } from "@wordless/ui-kit";
import { AlertTriangle, Check, Copy, Download, Loader2, QrCode, RefreshCw, Smartphone, Trash2, Unlink, Wifi } from "lucide-react";
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
  /** 教程档的三个输入(服务器、用户、域名)与"准备部署包"的结果。 */
  const [deployServer, setDeployServer] = useState("");
  const [deployUser, setDeployUser] = useState("");
  const [deployDomain, setDeployDomain] = useState("");
  /** 两个端口(默认 8787 / 443):留空就是默认值。 */
  const [relayPortDraft, setRelayPortDraft] = useState("");
  const [publicPortDraft, setPublicPortDraft] = useState("");
  const [deployBundleDir, setDeployBundleDir] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deploySteps, setDeploySteps] = useState<
    Array<{ id: string; command: string; sudo: boolean }> | null
  >(null);
  const [deployPlan, setDeployPlan] = useState<{
    relayBaseUrl: string;
    secure: boolean;
    proxy?: "caddy" | "nginx";
    skipped: readonly { readonly id: string; readonly reason: string }[];
    warnings: readonly { readonly key: string; readonly detail?: string }[];
  } | null>(null);
  /** 自动部署(SSH):认证方式、密码、端口,以及探测结果与逐步进度。 */
  const [sshAuth, setSshAuth] = useState<"key" | "password">("key");
  const [sshPassword, setSshPassword] = useState("");
  const [sshPort, setSshPort] = useState("");
  const [sshProbed, setSshProbed] = useState<{
    findings: readonly string[];
    facts: DeployProbeFacts;
  } | null>(null);
  const [sshProbeError, setSshProbeError] = useState<string | null>(null);
  /**
   * 撤下来(停用 / 卸载)。
   *
   * 卸载**不可逆**,所以它的计划先摆在确认框里(要删什么、跑什么命令都看得见);
   * 停用可逆,所以点了就跑 —— 给可逆的动作也摆一个确认框,只会训练用户闭眼点"确定"。
   */
  const [uninstallPlan, setUninstallPlan] = useState<RemoteUninstallPlan | null>(null);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [uninstallConfirming, setUninstallConfirming] = useState(false);
  /**
   * 正在跑的是**哪一件事**。
   *
   * 三者共用同一个进度通道,所以按钮与结果那句话都得按它来 —— 卸载的时候显示"正在部署…",
   * 用户会以为点错了。
   */
  const [sshAction, setSshAction] = useState<"deploy" | "stop" | "remove">("deploy");
  /**
   * 远程部署那一节的两档:**自己部署(教程)** / **自动部署(SSH)**。
   *
   * 两条路跑的是**同一份命令**,但做法完全不同(一个你自己敲,一个我替你连上去敲)。
   * 堆在一页上时用户分不清哪一步属于哪条路(真实反馈)—— 所以分成两档,切换器下面只摆当前这一档。
   */
  const [deployTab, setDeployTab] = useState<"tutorial" | "ssh">("tutorial");
  const [sshProbing, setSshProbing] = useState(false);
  const [sshRunning, setSshRunning] = useState(false);
  const [sshProgress, setSshProgress] = useState<
    Array<{ index: number; id: string; status: "running" | "done" | "failed"; output?: string }>
  >([]);
  const [sshResult, setSshResult] = useState<{ ok: boolean; failedStep?: string; error?: string } | null>(null);
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
        /**
         * **失败之后重读一次状态。**
         *
         * 主进程可能已经把事情做了一半(档位写进去了、服务停了),而这一次调用只是回不来 ——
         * 界面要是继续显示旧状态,用户就会觉得"点了没反应"(真实抱怨:切换档位切不过去)。
         * 重读一次,界面与主进程就重新对齐;错误照旧显示出来。
         */
        try {
          apply(await client.getRemoteAccessState());
        } catch {
          // 连状态都读不到(通道断了):保持原样,错误已经显示出来了。
        }
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

  /** 部署进度:主进程逐步推过来(哪一步在跑、跑到哪了)。 */
  useEffect(() => {
    const subscribe = client.onRemoteDeployProgress;
    if (typeof subscribe !== "function") return;
    return subscribe((progress) => {
      setSshProgress((current) => {
        const next = current.filter((entry) => entry.index !== progress.index);
        return [...next, progress].sort((left, right) => left.index - right.index);
      });
    });
  }, [client]);

  const copy = useCallback(async (kind: "code" | "password" | "quick", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1_500);
    } catch {
      // 剪贴板不可用(权限/无焦点)不是错误:用户还能自己看、自己敲。
    }
  }, []);

  /** 准备部署包:把两样东西复制到"下载 / wordless-deploy",好让教程里那句 scp 指得到。 */
  const prepareBundle = useCallback(async () => {
    setDeployError(null);
    try {
      const result = await client.prepareRemoteDeployBundle();
      if (!result.ok || result.dir === undefined) {
        setDeployError(result.error ?? t("remoteAccessError"));
        return;
      }
      setDeployBundleDir(result.dir);
    } catch (failure) {
      setDeployError(failure instanceof Error ? failure.message : t("remoteAccessError"));
    }
  }, [client, t]);

  /** 两个端口:填的是数字才算,留空/填错就是"用默认值"(计划那边还会再收一道)。 */
  const deployPorts = useCallback(() => {
    const parse = (value: string): number | undefined => {
      const trimmed = value.trim();
      if (trimmed.length === 0) return undefined;
      const port = Number(trimmed);
      return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : undefined;
    };
    return { relayPort: parse(relayPortDraft), publicPort: parse(publicPortDraft) };
  }, [publicPortDraft, relayPortDraft]);

  /**
   * 取部署步骤。
   *
   * 输入不全就**不请求** —— 命令里出现空的服务器地址,用户抄下去只会得到一堆莫名其妙的失败。
   */
  const loadDeployPlan = useCallback(async () => {
    setDeployError(null);
    if (deployServer.trim().length === 0 || deployUser.trim().length === 0) {
      setDeployError(t("remoteDeployNeedInputs"));
      return;
    }
    try {
      const plan = await client.getRemoteDeployPlan({
        server: deployServer.trim(),
        user: deployUser.trim(),
        // **整份**探测结果带过去:跳过哪些步骤、走哪条反代路线都由它决定。
        // (以前只带 node 那两项,于是"nginx 在跑"到不了计划 —— 计划永远按 Caddy 走。)
        ...(sshProbed === null ? {} : { facts: sshProbed.facts }),
        ...(deployDomain.trim().length === 0 ? {} : { domain: deployDomain.trim() }),
        ...(deployPorts().relayPort === undefined ? {} : { relayPort: deployPorts().relayPort }),
        ...(deployPorts().publicPort === undefined ? {} : { publicPort: deployPorts().publicPort }),
      });
      setDeploySteps([...plan.steps]);
      // `skipped` 可能没有(旧版本的本机、或测试替身):缺了就当"什么都没跳过"。
      setDeployPlan({
        relayBaseUrl: plan.relayBaseUrl,
        secure: plan.secure,
        ...(plan.proxy === undefined ? {} : { proxy: plan.proxy }),
        skipped: [...(plan.skipped ?? [])],
        warnings: [...(plan.warnings ?? [])],
      });
    } catch (failure) {
      setDeployError(failure instanceof Error ? failure.message : t("remoteAccessError"));
    }
  }, [client, deployDomain, deployPorts, deployServer, deployUser, sshProbed, t]);

  /** 连上服务器的参数:密码只在这一次请求里,不写进任何持久状态。 */
  const sshInput = useCallback(
    () => ({
      server: deployServer.trim(),
      user: deployUser.trim(),
      ...(sshPort.trim().length === 0 ? {} : { port: Number(sshPort.trim()) }),
      ...(sshAuth === "password" && sshPassword.length > 0 ? { password: sshPassword } : {}),
    }),
    [deployServer, deployUser, sshAuth, sshPassword, sshPort],
  );

  const probeSsh = useCallback(async () => {
    setSshProbeError(null);
    setSshProbed(null);
    if (deployServer.trim().length === 0 || deployUser.trim().length === 0) {
      setSshProbeError(t("remoteDeployNeedInputs"));
      return;
    }
    setSshProbing(true);
    try {
      const result = await client.probeRemoteDeploy({
        ...sshInput(),
        // 中继端口一起测:否则"8787 被别的程序占着"要等部署到一半才发现。
        ...(deployPorts().relayPort === undefined ? {} : { relayPort: deployPorts().relayPort }),
      });
      if (!result.ok) {
        setSshProbeError(result.error ?? t("remoteAccessError"));
        return;
      }
      setSshProbed({ findings: result.findings, facts: result.facts });
    } catch (failure) {
      setSshProbeError(failure instanceof Error ? failure.message : t("remoteAccessError"));
    } finally {
      setSshProbing(false);
    }
  }, [client, deployPorts, deployServer, deployUser, sshInput, t]);

  const runSsh = useCallback(async () => {
    // 没探测过就不跑:连不上的话后面每一步都是白跑,而用户会以为"部署过了"。
    if (sshProbed === null) {
      setSshProbeError(t("remoteSshNeedProbe"));
      return;
    }
    setSshProbeError(null);
    setSshProgress([]);
    setSshResult(null);
    setSshAction("deploy");
    setSshRunning(true);
    try {
      const result = await client.runRemoteDeploy({
        server: deployServer.trim(),
        user: deployUser.trim(),
        ...(deployDomain.trim().length === 0 ? {} : { domain: deployDomain.trim() }),
        ...(sshPort.trim().length === 0 ? {} : { port: Number(sshPort.trim()) }),
        ...(deployPorts().relayPort === undefined ? {} : { relayPort: deployPorts().relayPort }),
        ...(deployPorts().publicPort === undefined ? {} : { publicPort: deployPorts().publicPort }),
        ...(sshProbed === null ? {} : { facts: sshProbed.facts }),
        ...(sshAuth === "password" && sshPassword.length > 0 ? { password: sshPassword } : {}),
      });
      setSshResult(result);
    } catch (failure) {
      setSshResult({ ok: false, error: failure instanceof Error ? failure.message : t("remoteAccessError") });
    } finally {
      setSshRunning(false);
      // 用完就丢:密码不该在界面上多留一秒。
      setSshPassword("");
    }
  }, [client, deployDomain, deployPorts, deployServer, deployUser, sshAuth, sshInput, sshPassword, sshProbed, t]);

  /**
   * 卸载:先要一份计划(**只包含探测到确实存在的东西**),摆进确认框。
   *
   * 没探到任何东西时不摆确认框,直接说清楚 —— 让用户对着一个"要删:无"的框点确定,
   * 是在消耗他对这个框的信任。
   */
  /** Esc 取消卸载确认 —— 与侧栏的删除确认、绕过审批确认同一条规矩。 */
  useEffect(() => {
    if (!uninstallConfirming) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setUninstallConfirming(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [uninstallConfirming]);

  const loadUninstallPlan = useCallback(async () => {
    setUninstallError(null);
    if (sshProbed === null) {
      setUninstallError(t("remoteSshNeedProbe"));
      return;
    }
    try {
      const plan = await client.getRemoteUninstallPlan({
        scope: "remove",
        ...(deployPorts().relayPort === undefined ? {} : { relayPort: deployPorts().relayPort }),
        facts: sshProbed.facts,
      });
      if (plan.nothingToDo) {
        setUninstallError(t("remoteMaintenanceNothing"));
        return;
      }
      setUninstallPlan(plan);
      setUninstallConfirming(true);
    } catch (failure) {
      setUninstallError(failure instanceof Error ? failure.message : t("remoteAccessError"));
    }
  }, [client, deployPorts, sshProbed, t]);

  const runUninstall = useCallback(
    async (scope: "stop" | "remove") => {
      if (sshProbed === null) {
        setUninstallError(t("remoteSshNeedProbe"));
        return;
      }
      setUninstallConfirming(false);
      setUninstallError(null);
      setSshProgress([]);
      setSshResult(null);
      setSshAction(scope);
      setSshRunning(true);
      try {
        const result = await client.runRemoteUninstall({
          server: deployServer.trim(),
          user: deployUser.trim(),
          scope,
          ...(sshPort.trim().length === 0 ? {} : { port: Number(sshPort.trim()) }),
          ...(deployPorts().relayPort === undefined ? {} : { relayPort: deployPorts().relayPort }),
          facts: sshProbed.facts,
          ...(sshAuth === "password" && sshPassword.length > 0 ? { password: sshPassword } : {}),
        });
        if (result.ok && result.nothingToDo === true) {
          // 服务器上没东西可撤:说清楚,而不是显示一句"已完成"(那句话在这里是假的)。
          setUninstallError(t("remoteMaintenanceNothing"));
          return;
        }
        setSshResult(result);
      } catch (failure) {
        setSshResult({ ok: false, error: failure instanceof Error ? failure.message : t("remoteAccessError") });
      } finally {
        setSshRunning(false);
        // 用完就丢:密码不该在界面上多留一秒。
        setSshPassword("");
        setUninstallPlan(null);
      }
    },
    [client, deployPorts, deployServer, deployUser, sshAuth, sshPassword, sshPort, sshProbed, t],
  );

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
      {/*
        接入方式:两档平铺,不做"点一下循环"(循环是隐藏状态,用户得试两下才知道自己在哪一档)。
        与"外观"那一组同一个形状,所以页面里只有一种"选择器"的样子。
      */}
      <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
        <h2 className="text-[14px] font-semibold">{t("remoteModeTitle")}</h2>
        <div className="mt-2 flex items-center gap-1" role="group" aria-label={t("remoteModeTitle")}>
          {(["lan", "remote"] as const).map((mode) => {
            const active = view.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={() => void run(() => client.setRemoteMode(mode))}
                className={`h-8 min-w-0 flex-1 rounded-[7px] border text-[12px] transition-colors ${
                  active
                    ? "border-border bg-muted text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {t(mode === "lan" ? "remoteModeLan" : "remoteModeRemote")}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          {busy
            ? t("remoteModeSwitching")
            : view.mode === "lan"
              ? t("remoteModeLanHint")
              : t("remoteModeRemoteHint")}
        </p>
      </section>

      {/*
        局域网档 —— **一键**。
        起服务、填地址、开启都在主进程里一次做完,所以这里只有一个开关;失败时状态里带回原因。
        放在最前面,是因为它是"什么都不用装"的那条路:大多数用户只该看到这一块。
      */}
      {view.lan === undefined || view.mode !== "lan" ? null : (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] border border-[#cfd9b8] bg-[#f5f8eb] text-[#60753a] dark:border-[#53663a] dark:bg-[#303b1d] dark:text-[#d7efa5]">
                <Wifi aria-hidden="true" className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-[14px] font-semibold">{t("remoteLanTitle")}</h2>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteLanDescription")}</p>
              </div>
            </div>
            <Switch
              checked={view.lan.running}
              disabled={busy}
              aria-label={t("remoteLanTitle")}
              onCheckedChange={(enabled) => void run(() => client.setRemoteLanMode(enabled))}
            />
          </div>

          <div className="mt-3 space-y-2 pl-11" role="status" aria-live="polite">
            {busy && !view.lan.running ? (
              <p className="flex items-center gap-2 text-[11px] leading-4 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
                {t("remoteLanStatusPreparing")}
              </p>
            ) : view.lan.running ? (
              <>
                <p className="flex items-center gap-2 text-[11px] leading-4 text-muted-foreground">
                  <Check className="size-3.5 text-accent-foreground" />
                  {t("remoteLanStatusRunning")}
                </p>
                {/* 端口被占用、自动换过:说出来,否则用户以为端口设置没生效。 */}
                {view.lan.portChanged && view.lan.port !== undefined ? (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    {t("remoteLanPortChanged").replace("{port}", String(view.lan.port))}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-[11px] leading-4 text-muted-foreground">
                {view.lan.error !== undefined
                  ? view.lan.error
                  : view.lan.webClientReady
                    ? t("remoteLanStatusOff")
                    : t("remoteLanStatusMissing")}
              </p>
            )}

            {view.lan.running && view.lan.phoneUrl !== undefined ? (
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t("remoteLanAddressLabel")}{" "}
                <code className="font-mono text-[11px] text-foreground">{view.lan.phoneUrl}</code>
              </p>
            ) : null}

            {/*
              多网卡让用户自己选,而且**只在他真的需要选的时候**才摆:
              只有一个地址时摆一排单选按钮只是噪音。
            */}
            {view.lan.running && view.lan.addresses.length > 1 ? (
              <div className="space-y-1">
                <p className="text-[11px] leading-4 text-muted-foreground">{t("remoteLanAddressHint")}</p>
                {view.lan.addresses.map((entry) => (
                  <button
                    key={entry.address}
                    type="button"
                    aria-pressed={entry.selected}
                    disabled={busy}
                    onClick={() => void run(() => client.setRemoteLanAddress(entry.address))}
                    className={`flex w-full items-center justify-between gap-2 rounded-[7px] border px-2.5 py-1.5 text-left font-mono text-[11px] transition-colors ${
                      entry.selected
                        ? "border-[#cfd9b8] bg-[#f5f8eb] text-foreground dark:border-[#53663a] dark:bg-[#303b1d]"
                        : "border-transparent text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <span className="truncate">{entry.address}</span>
                    <span className="shrink-0 font-sans text-[10px] opacity-70">{entry.name}</span>
                  </button>
                ))}
              </div>
            ) : null}

            {/* 一键到不了的地方写在明面上:手机得在同一个 WiFi、防火墙要放行。 */}
            <details className="text-[11px] leading-4 text-muted-foreground">
              <summary className="cursor-pointer select-none">{t("remoteLanTrouble")}</summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-4">
                <li>{t("remoteLanTroubleWifi")}</li>
                <li>{t("remoteLanTroubleFirewall")}</li>
                <li>{t("remoteLanTroubleAddress")}</li>
              </ul>
            </details>
          </div>
        </section>
      )}

      {/*
        开关与状态 —— **只在远程模式下**。
        局域网模式下开关在它自己那一档里(那一下就是"一键":起服务 + 填地址 + 开启),
        这里再摆一个只会让人问"两个开关有什么区别"。
      */}
      {view.mode !== "remote" ? null : (
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
      )}

      {/*
        服务器 —— **教程与自动部署共用这一份**。
        原来这三个输入挂在教程那一节里,于是"自动部署(SSH)"看起来没有地方填服务器地址(真实抱怨)。
        搬出来单独一节,两处都从它读,谁也不会漏。
      */}
      {view.mode === "remote" ? (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <h2 className="text-[14px] font-semibold">{t("remoteServerTitle")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteServerHint")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {(
              [
                ["server", deployServer, setDeployServer, "remoteDeployServer", "remoteDeployServerPlaceholder"],
                ["user", deployUser, setDeployUser, "remoteDeployUser", "remoteDeployUserPlaceholder"],
                ["domain", deployDomain, setDeployDomain, "remoteDeployDomain", "remoteDeployDomainPlaceholder"],
              ] as const
            ).map(([key, value, setValue, labelKey, placeholderKey]) => (
              <label key={key} className="min-w-0 text-[11px] leading-4 text-muted-foreground">
                {t(labelKey)}
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={t(placeholderKey)}
                  className="mt-1 h-8 w-full min-w-0 rounded-[7px] border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none"
                />
              </label>
            ))}
            <label className="min-w-0 text-[11px] leading-4 text-muted-foreground">
              {t("remoteServerRelayPort")}
              <input
                value={relayPortDraft}
                onChange={(event) => setRelayPortDraft(event.target.value)}
                placeholder="8787"
                className="mt-1 h-8 w-full min-w-0 rounded-[7px] border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none"
              />
            </label>
            <label className="min-w-0 text-[11px] leading-4 text-muted-foreground">
              {t("remoteServerPublicPort")}
              <input
                value={publicPortDraft}
                onChange={(event) => setPublicPortDraft(event.target.value)}
                placeholder="443"
                className="mt-1 h-8 w-full min-w-0 rounded-[7px] border border-border bg-background px-2 font-mono text-[11px] text-foreground outline-none"
              />
            </label>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{t("remoteDeployDomainHint")}</p>
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {t("remoteServerRelayPortHint")} {t("remoteServerPublicPortHint")}
          </p>
        </section>
      ) : null}

      {/*
        部署包:两条路**都要**它 —— 教程里那句 `scp` 指向它,自动部署也从这里上传。
        所以它不属于任何一档,单独一节放在上面。
      */}
      {view.mode === "remote" ? (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <h2 className="text-[14px] font-semibold">{t("remoteDeployBundleTitle")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteDeployBundleHint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void prepareBundle()}>
              <Download className="size-4" />
              {deployBundleDir === null ? t("remoteDeployPrepare") : t("remoteDeployPrepared")}
            </Button>
            <span className="min-w-0 break-all text-[11px] leading-4 text-muted-foreground">
              {deployBundleDir === null ? t("remoteDeployPrepareHint") : deployBundleDir}
            </span>
          </div>
        </section>
      ) : null}

      {/*
        怎么部署:**两条路分成两档**。

        以前教程与自动部署堆在同一页上,用户分不清哪一步属于哪条路(真实反馈)—— 而它们其实是
        同一件事的两种做法:自动部署跑的**就是**教程里那份命令。所以两档共用一个标题与一句说明,
        切换器下面只摆当前那一档的东西。
      */}
      {view.mode === "remote" ? (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <h2 className="text-[14px] font-semibold">{t("remoteDeployHowTitle")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteDeployHowHint")}</p>
          <div className="mt-2 flex items-center gap-1" role="group" aria-label={t("remoteDeployHowTitle")}>
            {(["tutorial", "ssh"] as const).map((tab) => {
              const active = deployTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDeployTab(tab)}
                  className={`h-8 min-w-0 flex-1 rounded-[7px] border text-[12px] transition-colors ${
                    active
                      ? "border-border bg-muted text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {t(tab === "tutorial" ? "remoteDeployTabManual" : "remoteSshTitle")}
                </button>
              );
            })}
          </div>

          {deployTab === "tutorial" ? (
            <>
              <p className="mt-3 text-[11px] leading-4 text-muted-foreground">{t("remoteDeployHint")}</p>

              {/* 要求清单:先确认这几件事,再动手。 */}
              <div className="mt-3 rounded-[7px] bg-muted/50 px-3 py-2">
                <p className="text-[11px] font-medium text-foreground">{t("remoteDeployRequirements")}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-4 text-muted-foreground">
                  <li>{t("remoteDeployReqServer")}</li>
                  <li>{t("remoteDeployReqDomain")}</li>
                  <li>{t("remoteDeployReqPorts")}</li>
                  <li>{t("remoteDeployReqNode")}</li>
                </ul>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button onClick={() => void loadDeployPlan()}>{t("remoteDeploySteps")}</Button>
                <span className="text-[11px] leading-4 text-muted-foreground">{t("remoteDeployStepsHint")}</span>
              </div>

              {deployError === null ? null : (
                <p className="mt-2 text-[11px] leading-4 text-[#8a4b2a] dark:text-[#e0b394]">{deployError}</p>
              )}

              <DeployPlanPanel
                copied={copied}
                onCopy={(command) => void copy("quick", command)}
                onFillAddress={() => void run(() => client.setRemoteRelayUrl(deployPlan?.relayBaseUrl ?? ""))}
                plan={deployPlan}
                steps={deploySteps}
                t={t}
              />
            </>
          ) : (
            <>
                <p className="mt-3 text-[11px] leading-4 text-muted-foreground">{t("remoteSshHint")}</p>
                  {/*
                把"连到哪台服务器"写在明面上:服务器地址在上面那一节里填,
                不写出来用户会以为这里缺一个输入框(真实抱怨)。
              */}
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {deployServer.trim().length === 0 ? (
                  t("remoteSshTargetMissing")
                ) : (
                  <>
                    {t("remoteSshTarget")}{" "}
                    <code className="font-mono text-[11px] text-foreground">
                      {deployUser.trim().length === 0 ? deployServer.trim() : `${deployUser.trim()}@${deployServer.trim()}`}
                      {sshPort.trim().length === 0 ? "" : `:${sshPort.trim()}`}
                    </code>
                  </>
                )}
              </p>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="flex items-center gap-1" role="group" aria-label={t("remoteSshTitle")}>
                  {(["key", "password"] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      aria-pressed={sshAuth === kind}
                      onClick={() => setSshAuth(kind)}
                      className={`h-8 rounded-[7px] border px-2.5 text-[11px] transition-colors ${
                        sshAuth === kind
                          ? "border-border bg-muted text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-muted/60"
                      }`}
                    >
                      {t(kind === "key" ? "remoteSshAuthKey" : "remoteSshAuthPassword")}
                    </button>
                  ))}
                </div>
                <label className="text-[11px] leading-4 text-muted-foreground">
                  {t("remoteSshPort")}
                  <input
                    value={sshPort}
                    onChange={(event) => setSshPort(event.target.value)}
                    placeholder="22"
                    className="mt-1 h-8 w-20 rounded-[7px] border border-border bg-background px-2 font-mono text-[11px] outline-none"
                  />
                </label>
                {sshAuth === "password" ? (
                  <label className="text-[11px] leading-4 text-muted-foreground">
                    {t("remoteSshPassword")}
                    <input
                      value={sshPassword}
                      type="password"
                      onChange={(event) => setSshPassword(event.target.value)}
                      className="mt-1 h-8 w-40 rounded-[7px] border border-border bg-background px-2 font-mono text-[11px] outline-none"
                    />
                  </label>
                ) : null}
                <Button variant="outline" disabled={sshProbing || sshRunning} onClick={() => void probeSsh()}>
                  {sshProbing ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : null}
                  {sshProbing ? t("remoteSshProbing") : t("remoteSshProbe")}
                </Button>
                <Button disabled={sshRunning || sshProbed === null} onClick={() => void runSsh()}>
                {sshRunning && sshAction === "deploy" ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                  ) : null}
                {sshRunning && sshAction === "deploy" ? t("remoteSshRunning") : t("remoteSshRun")}
                </Button>
                {sshRunning ? (
                  <Button variant="outline" onClick={() => void client.cancelRemoteDeploy()}>
                    {t("remoteSshCancel")}
                  </Button>
                ) : null}
              </div>

              {/* 按钮为什么是灰的:**说出来**。灰着不说原因,用户只会以为坏了。 */}
              {sshProbed === null && !sshRunning ? (
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{t("remoteSshNeedProbe")}</p>
              ) : null}
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {sshAuth === "password" ? t("remoteSshPasswordHint") : t("remoteSshKeyHint")}
              </p>
              {/* 主机密钥:第一次记录指纹,之后变了就拒绝 —— 这才是防中间人的那一半。 */}
              <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("remoteSshHostKey")}</p>

              {sshProbeError === null ? null : (
                <p className="mt-2 text-[11px] leading-4 text-[#8a4b2a] dark:text-[#e0b394]">{sshProbeError}</p>
              )}

              {sshProbed === null ? null : (
                <div className="mt-3 rounded-[7px] bg-muted/50 px-3 py-2">
                  <p className="text-[11px] font-medium">{t("remoteSshProbeOk")}</p>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px] leading-4 text-muted-foreground">
                    {sshProbed.findings.map((finding) => (
                      <li key={finding}>{finding}</li>
                    ))}
                  </ul>
                  {/*
                    探测的**结论**:够不够用、要不要装。用户关心的是"我还要不要动这台机器的环境",
                    而不是 `node=v20.11.0` 这一行本身。
                  */}
                  <p className="mt-1.5 text-[11px] leading-4 text-foreground">
                    {(() => {
                      const node = sshProbed.facts.node;
                      if (node?.present !== true) return t("remoteSshNodeOld").replace("{version}", "—");
                      const version = node.version ?? "";
                      return (node.major ?? 0) >= 20
                        ? t("remoteSshNodeReady").replace("{version}", version)
                        : t("remoteSshNodeOld").replace("{version}", version);
                    })()}
                  </p>
                  {sshProbed.facts.sudo ? null : (
                    <p className="mt-1 text-[11px] leading-4 text-[#8a4b2a] dark:text-[#e0b394]">
                      {t("remoteSshNoSudo")}
                    </p>
                  )}
                </div>
              )}

              {sshProgress.length === 0 ? null : (
                <ol className="mt-3 space-y-2">
                  {sshProgress.map((entry) => (
                    <li key={entry.index} className="min-w-0">
                      <p className="flex items-center gap-2 text-[11px] leading-4">
                        {entry.status === "running" ? (
                          <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
                        ) : entry.status === "done" ? (
                          <Check className="size-3.5 shrink-0 text-accent-foreground" />
                        ) : (
                          <AlertTriangle className="size-3.5 shrink-0 text-[#8a4b2a]" />
                        )}
                        {t("remoteSshStep")
                          .replace("{index}", String(entry.index + 1))
                          .replace("{step}", t(`remoteDeployStep${entry.id}` as never))}
                      </p>
                      {entry.status === "failed" && entry.output !== undefined ? (
                        <pre className="mt-1 max-h-48 overflow-auto rounded-[7px] bg-[#f0f0ed] px-2.5 py-2 font-mono text-[10px] leading-4 whitespace-pre-wrap text-[#8a4b2a] dark:bg-muted dark:text-[#e0b394]">
                          {entry.output}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}

              {sshResult === null ? null : (
                <p
                  className={`mt-2 text-[11px] leading-4 ${
                    sshResult.ok ? "text-muted-foreground" : "text-[#8a4b2a] dark:text-[#e0b394]"
                  }`}
                >
                  {sshResult.ok
                  // 三件事共用这个结果行 —— 卸载完说"部署完成"就离谱了。
                  ? t(sshAction === "deploy" ? "remoteSshDone" : sshAction === "stop" ? "remoteSshStopped" : "remoteSshRemoved")
                    : sshResult.error === "已取消"
                      ? t("remoteSshCancelled")
                      : t("remoteSshFailed")
                          .replace("{index}", String((sshProgress.at(-1)?.index ?? 0) + 1))
                          .replace(
                            "{step}",
                            t(`remoteDeployStep${sshResult.failedStep ?? sshProgress.at(-1)?.id ?? ""}` as never),
                          )}
                </p>
              )}

              {/*
              **预览要跑什么**:跑的与「自己部署」那一档是同一份命令 —— 这一档不能因为"是自动的"
              就把命令藏起来(那正是"预览即所跑"要防的事)。
              */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => void loadDeployPlan()}>
                  {t("remoteSshPreviewSteps")}
                  </Button>
                {deploySteps === null ? null : (
                  <span className="text-[11px] leading-4 text-muted-foreground">{t("remoteSshPreviewHint")}</span>
                  )}
                </div>
              {deployError === null ? null : (
                <p className="mt-2 text-[11px] leading-4 text-[#8a4b2a] dark:text-[#e0b394]">{deployError}</p>
                )}
              <DeployPlanPanel
                copied={copied}
                onCopy={(command) => void copy("quick", command)}
                onFillAddress={() => void run(() => client.setRemoteRelayUrl(deployPlan?.relayBaseUrl ?? ""))}
                plan={deployPlan}
                steps={deploySteps}
                t={t}
                />

                {/*
                撤下来:装上去之后总得有办法拿掉 —— 而且**不替用户做主**。
                别人机器上的东西(证书、Caddy 本身)我们不动,只在计划里说清怎么自己删。
                */}
              <div className="mt-4 rounded-[7px] border border-border/70 px-3 py-2">
                <p className="text-[11px] font-medium text-foreground">{t("remoteMaintenanceTitle")}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("remoteMaintenanceHint")}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sshRunning || sshProbed === null}
                    onClick={() => void runUninstall("stop")}
                    >
                    {sshRunning && sshAction === "stop" ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
                    {sshRunning && sshAction === "stop" ? t("remoteMaintenanceStopping") : t("remoteMaintenanceStop")}
                    </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={sshRunning || sshProbed === null}
                    onClick={() => void loadUninstallPlan()}
                    >
                    <Trash2 className="size-3.5" />
                    {sshRunning && sshAction === "remove" ? t("remoteMaintenanceUninstalling") : t("remoteMaintenanceUninstall")}
                    </Button>
                  </div>
                {uninstallError === null ? null : (
                  <p className="mt-2 text-[11px] leading-4 text-[#8a4b2a] dark:text-[#e0b394]">{uninstallError}</p>
                  )}
                {/* 与部署那边同一条纪律:灰着不说原因,用户只会以为坏了。 */}
                  {sshProbed === null && !sshRunning ? (
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("remoteSshNeedProbe")}</p>
                  ) : null}
                    </div>
            </>
          )}
        </section>
      ) : null}

      {/*
        卸载确认:把**要删什么、跑什么命令**摆出来再点。不可逆的动作不该只有"信任"一条路。
      */}
      {uninstallConfirming && uninstallPlan !== null ? (
        <div
          aria-modal="true"
          role="dialog"
          className="fixed inset-0 z-[130] grid place-items-center bg-[#21211f]/45 p-4 backdrop-blur-[2px]"
        >
          <div className="w-full max-w-[560px] rounded-[18px] border border-border bg-white p-5 shadow-[0_24px_60px_rgba(0,0,0,0.22)] dark:bg-card">
            <h2 className="text-[15px] font-semibold">{t("remoteMaintenanceConfirmTitle")}</h2>
            <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
              {t("remoteMaintenanceConfirmBody").replace(
                "{target}",
                deployUser.trim().length === 0 ? deployServer.trim() : `${deployUser.trim()}@${deployServer.trim()}`,
              )}
            </p>
            {uninstallPlan.warnings.length === 0 ? null : (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-4 text-muted-foreground">
                {uninstallPlan.warnings.map((warning) => (
                  <li key={warning.key}>{t(warning.key as never).replace("{detail}", warning.detail ?? "")}</li>
                ))}
              </ul>
            )}
            {/* 没找到的那几样也要列出来:"你有没有删我的 nginx 配置"这类疑问,答案就在这里。 */}
            {uninstallPlan.skipped.length === 0 ? null : (
              <ul className="mt-2 space-y-1">
                {uninstallPlan.skipped.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-accent-foreground" />
                    {t("remoteMaintenanceSkipped")
                      .replace("{step}", t(`remoteDeployStep${entry.id}` as never))
                      .replace("{reason}", entry.reason)}
                  </li>
                ))}
              </ul>
            )}
            <ol className="mt-3 max-h-[280px] space-y-2 overflow-y-auto">
              {uninstallPlan.steps.map((step) => (
                <li key={step.id}>
                  <p className="text-[12px] font-medium">{t(`remoteDeployStep${step.id}` as never)}</p>
                  <pre className="mt-1 max-h-40 overflow-auto rounded-[7px] bg-[#f0f0ed] px-2.5 py-2 font-mono text-[11px] leading-5 whitespace-pre text-foreground dark:bg-muted">
                    {step.command}
                  </pre>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                size="sm"
                type="button"
                variant="outline"
                disabled={sshRunning}
                onClick={() => setUninstallConfirming(false)}
              >
                {t("cancel")}
              </Button>
              <Button
                size="sm"
                type="button"
                className="bg-[#d8443c] text-white hover:bg-[#c23934]"
                disabled={sshRunning}
                onClick={() => void runUninstall("remove")}
              >
                {sshRunning ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" /> : null}
                {t("remoteMaintenanceConfirmAction")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 配对:连接码 + 二维码 */}
      {view.enabled ? (
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <h2 className="text-[14px] font-semibold">{t("remoteAccessPairingTitle")}</h2>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("remoteAccessPairingHint")}</p>
          {/* 连接码是**给当前这一档**的:不说的话,用户会以为一个码两种方式都能用。 */}
          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
            {t(view.mode === "lan" ? "remoteAccessPairingLanNote" : "remoteAccessPairingRemoteNote")}
          </p>

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
          /*
            **按接入方式分组**:局域网配对的手机只在同一个 WiFi 里能连上,远程配对的在哪都行 ——
            混在一张列表里用户分不出哪台是哪台(真实反馈)。当前档位那一组在最前面,
            另一组会说明"要切回去才能连它"(否则"我的手机怎么老是不在线"永远解释不清)。
          */
          <div className="mt-3 space-y-4">
            {view.deviceGroups.map((group) => (
              <div key={group.mode}>
                <p className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                  {t(group.labelKey).replace("{count}", String(group.devices.length))}
                  {group.current ? (
                    <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      {t("remoteAccessDevicesCurrent")}
                    </span>
                  ) : null}
                </p>
                {group.current ? null : (
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {t(
                      group.mode === "lan"
                        ? "remoteAccessDevicesLanGroupHint"
                        : group.mode === "remote"
                          ? "remoteAccessDevicesRemoteGroupHint"
                          : "remoteAccessDevicesUnknownGroupHint",
                    )}
                  </p>
                )}
                <ul className="mt-1 divide-y divide-border">
                  {group.devices.map((device) => (
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
              </div>
            ))}
          </div>
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

      {/* 中继地址 —— 只有远程模式才由用户填:局域网模式的地址是网卡 + 端口算出来的。 */}
      {view.enabled && view.mode === "remote" ? (
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
/**
 * 部署计划的**渲染**(步骤、警告、跳过、最后一步)。
 *
 * 抽成组件是因为它要在**两处**出现:教程那一档(照着抄)与自动部署那一档(预览要跑什么)。
 * 两处渲染的是**同一份计划** —— 这正是"预览即所跑"那条纪律在界面上的样子。
 */
function DeployPlanPanel({
  copied,
  onCopy,
  onFillAddress,
  plan,
  steps,
  t,
}: {
  copied: string | null;
  onCopy: (command: string) => void;
  onFillAddress: () => void;
  plan: { secure: boolean; proxy?: "caddy" | "nginx"; warnings: readonly { key: string; detail?: string }[]; skipped: readonly { id: string; reason: string }[]; relayBaseUrl: string } | null;
  steps: readonly { id: string; command: string; sudo: boolean }[] | null;
  t: (key: Parameters<ReturnType<typeof usePreferences>["t"]>[0]) => string;
}) {
  return (
    <>
        {plan !== null && plan.secure === false ? (
          <p className="mt-2 flex items-start gap-2 rounded-[7px] bg-[#fdf3ec] px-3 py-2 text-[11px] leading-4 text-[#8a4b2a] dark:bg-[#3a211d] dark:text-[#e0b394]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {t("remoteDeployInsecure")}
          </p>
        ) : null}

        {/*
          警告**不拦路**:它们说的是"失败了也看不出原因"的那几件事(发行版、端口被占、已经部署过)。
          拦下来等于替用户做决定 —— 他可能就是想用那个端口。
        */}
        {/*
          走的是哪条路线要说出来:教程里写的是 Caddy,而服务器上是 nginx ——
          不说清楚用户会以为我们跑错了。
        */}
        {plan?.proxy === "nginx" ? (
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
            {t("remoteDeployStepNginxSite")} · {t("remoteDeployStepNginxCert")}
          </p>
        ) : null}

        {plan === null || plan.warnings.length === 0 ? null : (
          <div className="mt-3 rounded-[7px] bg-[#fdf3ec] px-3 py-2 dark:bg-[#3a211d]">
            <p className="text-[11px] font-medium text-[#8a4b2a] dark:text-[#e0b394]">{t("remoteWarnTitle")}</p>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-4 text-[#8a4b2a] dark:text-[#e0b394]">
              {plan.warnings.map((warning) => (
                <li key={warning.key}>
                  {t(warning.key as never).replace("{detail}", warning.detail ?? "")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan === null || plan.skipped.length === 0 ? null : (
          <ul className="mt-3 space-y-1">
            {plan.skipped.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-[11px] leading-4 text-muted-foreground">
                <Check className="size-3.5 shrink-0 text-accent-foreground" />
                {t("remoteSshSkipped").replace("{detail}", `${t(`remoteDeployStep${entry.id}` as never)} ${entry.reason}`.trim())}
              </li>
            ))}
          </ul>
        )}

        {steps === null ? null : (
          <ol className="mt-3 space-y-3">
            {steps.map((step, index) => (
              <li key={step.id} className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-medium">
                    {index + 1}
                  </span>
                  <span className="text-[12px] font-medium">
                    {t(`remoteDeployStep${step.id}` as never)}
                  </span>
                  {step.sudo ? (
                    <span className="rounded-[5px] bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t("remoteDeploySudo")}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 pl-7 text-[11px] leading-4 text-muted-foreground">
                  {t(`remoteDeployStep${step.id}Note` as never)}
                </p>
                <div className="mt-1.5 pl-7">
                  <pre className="max-h-56 overflow-auto rounded-[7px] bg-[#f0f0ed] px-2.5 py-2 font-mono text-[11px] leading-5 whitespace-pre text-foreground dark:bg-muted">
                    {step.command}
                  </pre>
                  <button
                    type="button"
                    onClick={() => onCopy(step.command)}
                    className="mt-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {copied === "quick" ? t("remoteDeployCopied") : t("remoteDeployCopy")}
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        {plan === null ? null : (
          <div className="mt-4 rounded-[7px] border border-[#cfd9b8] bg-[#f5f8eb] px-3 py-2 dark:border-[#53663a] dark:bg-[#303b1d]">
            <p className="text-[12px] font-medium">{t("remoteDeployFinish")}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{t("remoteDeployFinishHint")}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="font-mono text-[11px] text-foreground">{plan.relayBaseUrl}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={onFillAddress}
              >
                {t("remoteDeployFill")}
              </Button>
            </div>
          </div>
        )}
    </>
  );
}

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
