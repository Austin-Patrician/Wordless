import {
  summarizeTokenUsage,
  type SessionTurnUsage,
  type TokenUsageSummary,
  type TurnLatencySummary,
} from "@wordless/domain";
import type { SessionUsageSnapshot } from "@wordless/protocol";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@wordless/ui-kit";
import { ChartColumn, LoaderCircle } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { formatTokenCount } from "../../shared/format-tokens";
import { usePreferences } from "../../shared/preferences";

function formatPercent(value: number | null): string | null {
  return value === null ? null : `${(value * 100).toFixed(1)}%`;
}

function formatCost(value: number): string {
  return `$${value.toFixed(4)}`;
}

/** 毫秒 → `850ms` / `1.2s`。亚秒级不给小数位:TTFT 的抖动本来就大于 10ms。 */
function formatLatency(milliseconds: number): string {
  return milliseconds < 1_000
    ? `${Math.round(milliseconds)}ms`
    : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function formatSpeed(tokensPerSecond: number): string {
  return `${tokensPerSecond.toFixed(1)} tok/s`;
}

/**
 * 四段的配色。
 *
 * **必须是真实颜色**:这里一开始抄了参考实现的 `var(--context-segment-*)`,而 Wordless 从未定义过
 * 那几个变量 —— 四段全是透明的,长条看起来就是"没分段"。用和上下文构成条同一套色,顺便让两个
 * 地方的"构成"是同一种视觉语言。
 */
const SEGMENT_COLORS = ["#547ee8", "#20b896", "#e8b45d", "#8a5cf4"] as const;

type SessionUsageLoad =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; snapshot: SessionUsageSnapshot };

/**
 * 一块用量面板。**同一套渲染给"本轮"和"会话总计"用** —— 两个范围的差别只是数据的来源,
 * 数字的口径必须一致(会话总计同样由 `summarizeTokenUsage` 从 journal 记录算出)。
 */
function UsagePanel({
  summary,
  title,
  extras,
  latency,
}: {
  summary: TokenUsageSummary;
  title: string;
  extras?: readonly (readonly [string, string])[];
  /**
   * 速度与首 token 耗时。**只有"本轮"有** —— 会话总计还没有按会话聚合时间事实(见
   * `docs/architecture/token-usage-accounting.md`),所以这里缺省就不渲染这一块,
   * 而不是显示一个 0。
   */
  latency?: TurnLatencySummary;
}) {
  const { t } = usePreferences();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hitRate = formatPercent(summary.tokenHitRate);
  const readCoverage = formatPercent(summary.readCallCoverage);
  const writeCoverage = formatPercent(summary.writeCallCoverage);
  const parts = [
    { key: "input", label: t("turnTokenInput"), value: summary.inputTokens, color: SEGMENT_COLORS[0] },
    { key: "cacheRead", label: t("turnTokenCacheRead"), value: summary.cacheReadTokens, color: SEGMENT_COLORS[1] },
    { key: "cacheWrite", label: t("turnTokenCacheWrite"), value: summary.cacheWriteTokens, color: SEGMENT_COLORS[2] },
    { key: "output", label: t("turnTokenOutput"), value: summary.outputTokens, color: SEGMENT_COLORS[3] },
  ] as const;
  // 写入这一格不能只写百分比:没有调用上报过写入时,"0%"会被读成"写入占比 0%"。
  // 判断在领域层(`cacheWriteObservation`),这里只负责挑文案。
  const writeValue =
    summary.cacheWriteObservation === "read-only"
      ? t("turnUsageWriteUnavailable")
      : (writeCoverage ?? t("turnUsageUnreported"));

  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold text-[#40403c] dark:text-foreground">{title}</span>
        <span className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">
          {t("turnUsageCalls").replace("{count}", String(summary.modelCalls))}
          {summary.delegatedCalls > 0
            ? ` · ${t("turnUsageDelegated").replace("{count}", String(summary.delegatedCalls))}`
            : ""}
        </span>
      </div>

      <div className="mt-2 flex items-end justify-between gap-3 rounded-md bg-[#f6f7f4] px-2 py-1.5 dark:bg-muted/50">
        <div className="min-w-0">
          <div className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">{t("turnUsageCacheHitRate")}</div>
          <div
            className="mt-0.5 text-[20px] font-semibold leading-none tabular-nums text-[#397a9d] dark:text-[#9ccce2]"
            data-token-hit-rate={hitRate === null ? "unreported" : hitRate}
          >
            {hitRate ?? t("turnUsageUnreported")}
          </div>
          <div className="mt-1 text-[9px] text-[#a8adb2]">
            {t("turnUsageCoverage")
              .replace("{matched}", String(summary.cacheReadObservedCalls))
              .replace("{total}", String(summary.modelCalls))}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">{t("turnTokenTotal")}</div>
          <div className="mt-0.5 text-[13px] font-semibold leading-none tabular-nums text-[#5b5b55] dark:text-foreground">
            {formatTokenCount(summary.totalTokens)}
          </div>
        </div>
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2">
        <span className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">
          {t("turnUsagePrompt")} {formatTokenCount(summary.promptTokens)}
        </span>
        <span className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">
          {t("turnUsageEstimatedCost")} {formatCost(summary.totalCost)}
        </span>
      </div>

      {/*
        速度与首 token。口径写在 `title` 里(它们是"看起来合理但容易理解错"的两个数:首 token 含
        思考、速度不含首 token 也不含工具时间)。
        没有可观测调用时显示「未采集」而**不是** 0 —— 老记录与流式缺失都会落到这里,
        显示 0 会被读成"模型不吐字了"。
      */}
      {latency ? (
        <div
          className="mt-2 grid grid-cols-2 gap-2"
          data-turn-latency={latency.observedCalls === 0 ? "unobserved" : "observed"}
        >
          <div
            className="rounded-md bg-[#f6f7f4] px-2 py-1.5 dark:bg-muted/50"
            title={t("turnUsageFirstTokenHint")}
          >
            <div className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">
              {t("turnUsageFirstToken")}
            </div>
            <div
              className="mt-0.5 text-[13px] font-semibold leading-none tabular-nums text-[#40403c] dark:text-foreground"
              data-turn-first-token={latency.firstTokenMs === null ? "unreported" : Math.round(latency.firstTokenMs)}
            >
              {latency.firstTokenMs === null
                ? t("turnUsageLatencyUnavailable")
                : formatLatency(latency.firstTokenMs)}
            </div>
          </div>
          <div
            className="rounded-md bg-[#f6f7f4] px-2 py-1.5 dark:bg-muted/50"
            title={t("turnUsageOutputSpeedHint")}
          >
            <div className="text-[10px] text-[#8a8f94] dark:text-muted-foreground">
              {t("turnUsageOutputSpeed")}
            </div>
            <div
              className="mt-0.5 text-[13px] font-semibold leading-none tabular-nums text-[#40403c] dark:text-foreground"
              data-turn-output-speed={
                latency.outputTokensPerSecond === null
                  ? "unreported"
                  : latency.outputTokensPerSecond.toFixed(1)
              }
            >
              {latency.outputTokensPerSecond === null
                ? t("turnUsageLatencyUnavailable")
                : formatSpeed(latency.outputTokensPerSecond)}
            </div>
          </div>
        </div>
      ) : null}

      {latency && latency.observedCalls === 0 ? (
        <p className="mt-1 text-[9px] text-[#a8adb2]">{t("turnUsageLatencyUnavailableHint")}</p>
      ) : null}

      {/*
        按比例分段:用 `flexGrow` 给比例,而不是"宽度百分比 + 间隙"。后者在 overflow 时会按比例
        收缩,间隙还占掉 3px,看起来就"没按百分比"。做法与 `ContextUsageIndicator` 一致。
      */}
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-[#e7e7e3] dark:bg-muted">
        {parts
          .filter((part) => part.value > 0)
          .map((part) => (
            <span
              aria-hidden
              data-token-segment={part.key}
              key={part.key}
              style={{ backgroundColor: part.color, flexGrow: part.value, flexBasis: 0 }}
            />
          ))}
      </div>

      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
        {parts.map((part) => (
          <div className="flex items-center gap-1" key={part.key}>
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: part.color }}
            />
            <dt className="truncate text-[#8a8f94] dark:text-muted-foreground">{part.label}</dt>
            <dd className="ml-auto tabular-nums text-[#40403c] dark:text-foreground" title={String(part.value)}>
              {formatTokenCount(part.value)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-2 border-t border-[#eceee9] pt-1.5 dark:border-border/50">
        <button
          aria-expanded={detailsOpen}
          className="flex w-full items-center gap-1 text-[10px] text-[#8a8f94] transition-colors hover:text-[#5b5b55] dark:text-muted-foreground"
          onClick={() => setDetailsOpen((open) => !open)}
          type="button"
        >
          {t("turnUsageMore")}
        </button>
        {detailsOpen ? (
          <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 text-[10px]">
            <div className="contents">
              <dt className="truncate text-[#8a8f94] dark:text-muted-foreground">{t("turnUsageReadCoverage")}</dt>
              <dd className="text-right tabular-nums" data-token-read-coverage={readCoverage ?? "unreported"}>
                {readCoverage ?? t("turnUsageUnreported")}
              </dd>
            </div>
            <div className="contents">
              <dt className="truncate text-[#8a8f94] dark:text-muted-foreground">{t("turnUsageWriteCoverage")}</dt>
              <dd className="text-right tabular-nums" data-token-write-coverage={writeCoverage ?? "unreported"}>
                {writeValue}
              </dd>
            </div>
            {summary.reportedPromptCount > 0 ? (
              <div className="contents">
                <dt className="truncate text-[#8a8f94] dark:text-muted-foreground">
                  {t("turnUsageReconciliation")}
                </dt>
                <dd
                  className="text-right tabular-nums"
                  data-token-reconciliation={summary.reportedPromptDriftCount > 0 ? "drift" : "ok"}
                  title={t("turnUsageReconciliationValue")
                    .replace("{reported}", String(summary.reportedPromptTokens))
                    .replace("{components}", String(summary.promptTokens))}
                >
                  {summary.reportedPromptDriftCount > 0
                    ? t("turnUsageReconciliationDrift")
                        .replace("{count}", String(summary.reportedPromptDriftCount))
                        .replace("{max}", String(summary.reportedPromptMaxDrift))
                    : t("turnUsageReconciliationOk")}
                </dd>
              </div>
            ) : null}
            {extras?.map(([label, value]) => (
              <div className="contents" key={label}>
                <dt className="truncate text-[#8a8f94] dark:text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums text-[#40403c] dark:text-foreground">{value}</dd>
              </div>
            ))}
            {latency ? (
              <div className="contents">
                <dt className="truncate text-[#8a8f94] dark:text-muted-foreground">
                  {t("turnUsageLatencyCalls")}
                </dt>
                <dd
                  className="text-right tabular-nums text-[#40403c] dark:text-foreground"
                  data-turn-latency-coverage={`${latency.observedCalls}/${latency.totalCalls}`}
                >
                  {t("turnUsageLatencyCoverage")
                    .replace("{observed}", String(latency.observedCalls))
                    .replace("{total}", String(latency.totalCalls))}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {detailsOpen && latency && latency.calls.length > 0 ? (
          // 逐次调用:排障用(哪一次慢、哪一次没采集到)。**默认折叠**,与"调用级只作为明细"的口径一致。
          <ul
            className="mt-1.5 space-y-0.5 text-[10px]"
            data-turn-latency-call-count={latency.calls.length}
            title={t("turnUsageLatencyCallHint")}
          >
            {latency.calls.map((call) => (
              <li className="flex items-baseline gap-2 tabular-nums" key={call.index}>
                <span className="w-5 shrink-0 text-[#a8adb2]">#{call.index}</span>
                <span className="w-11 shrink-0 text-right text-[#8a8f94] dark:text-muted-foreground">
                  {call.firstTokenMs === null ? "—" : formatLatency(call.firstTokenMs)}
                </span>
                <span className="w-16 shrink-0 text-right text-[#8a8f94] dark:text-muted-foreground">
                  {call.outputTokensPerSecond === null ? "—" : formatSpeed(call.outputTokensPerSecond)}
                </span>
                <span className="ml-auto text-right text-[#a8adb2]">
                  {formatTokenCount(call.outputTokens)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </>
  );
}

/**
 * 一轮回复(或整个会话)的用量入口。
 *
 * **展示单位是轮次,不是每次模型调用** —— 用户的心智模型里这一来一往就是一件事,而一轮里模型
 * 被调用几次取决于工具循环转了几圈,那是实现细节。
 *
 * 面板里的率由 `summarizeTokenUsage` 算(本轮:合并后的用量;会话总计:runtime 从 journal 现算),
 * 所以"未上报"永远不会被算成"没命中"。
 */
export function TurnTokenUsageRow({
  usage,
  latency,
  loadSessionUsage,
}: {
  usage?: SessionTurnUsage;
  /** 本轮的速度与首 token 耗时(见 `summarizeTurnLatency`)。缺省 = 不显示这一块。 */
  latency?: TurnLatencySummary;
  /** 会话总计是懒加载的:只在用户真的切过去时才读 journal。没给就只显示本轮。 */
  loadSessionUsage?: () => Promise<SessionUsageSnapshot | null>;
}) {
  const { t } = usePreferences();
  const [scope, setScope] = useState<"turn" | "session">("turn");
  const [session, setSession] = useState<SessionUsageLoad>({ status: "idle" });
  const turnSummary = useMemo(
    () =>
      usage
        ? summarizeTokenUsage([usage], {
            primaryCalls: usage.primaryCallCount,
            delegatedCalls: usage.toolCallCount,
          })
        : undefined,
    [usage],
  );

  const selectSession = useCallback(() => {
    setScope("session");
    if (!loadSessionUsage) return;
    setSession((current) => {
      // 已经拿到过就不再读一遍:journal 是权威源,再读一次只会多一次磁盘遍历。
      if (current.status === "ready" || current.status === "loading") return current;
      void loadSessionUsage().then(
        (snapshot) => setSession(snapshot ? { status: "ready", snapshot } : { status: "failed" }),
        () => setSession({ status: "failed" }),
      );
      return { status: "loading" };
    });
  }, [loadSessionUsage]);

  if (!usage || !turnSummary) return null;

  const sessionSnapshot = session.status === "ready" ? session.snapshot : undefined;
  const summary = scope === "session" ? sessionSnapshot?.chat : turnSummary;
  // 会话总计还要交代两件"这个数不包括什么":拿不到用量的调用,以及图纸之外的图片开销。
  const extras: Array<readonly [string, string]> = [];
  if (scope === "session" && sessionSnapshot) {
    extras.push([
      t("turnUsageUnmeasuredCalls"),
      t("turnUsageCount").replace("{count}", String(sessionSnapshot.unmeasuredCalls)),
    ]);
    if (sessionSnapshot.image.operations > 0) {
      extras.push([
        t("turnUsageImageOperations"),
        t("turnUsageImageOperationsValue")
          .replace("{count}", String(sessionSnapshot.image.operations))
          .replace("{unmetered}", String(sessionSnapshot.image.unmeteredOperations))
          .replace("{cost}", formatCost(sessionSnapshot.image.totalCost)),
      ]);
    }
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            {/*
              只留图标:这一行已经有「复制」等按钮,再摆一段文字会挤。名字走 tooltip 与
              `aria-label` —— 一个给眼睛,一个给读屏器。
            */}
            <button
              aria-label={t("turnUsageOpen")}
              className="grid h-6 w-6 place-items-center rounded-[5px] text-[#8a8a80] transition-colors hover:bg-[#efefeb] hover:text-[#454540] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:bg-muted"
              data-turn-token-usage="trigger"
              type="button"
            >
              <ChartColumn aria-hidden className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("turnUsageOpen")}</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 p-3" data-turn-token-usage="panel" side="top" sideOffset={6}>
        {loadSessionUsage ? (
          <div
            aria-label={t("turnUsageScopeLabel")}
            className="mb-2 flex rounded-md bg-[#f1f2ef] p-0.5 dark:bg-muted/50"
            role="tablist"
          >
            {(["turn", "session"] as const).map((value) => (
              <button
                aria-selected={scope === value}
                className={`flex-1 rounded-sm px-1.5 py-1 text-[10px] transition-colors ${
                  scope === value
                    ? "bg-white text-[#40403c] dark:bg-card dark:text-foreground"
                    : "text-[#8a8f94] hover:text-[#5b5b55] dark:text-muted-foreground"
                }`}
                data-usage-scope={value}
                key={value}
                onClick={value === "session" ? selectSession : () => setScope("turn")}
                role="tab"
                type="button"
              >
                {t(value === "turn" ? "turnUsageScopeTurn" : "turnUsageScopeSession")}
              </button>
            ))}
          </div>
        ) : null}
        {scope === "session" && !summary ? (
          <div
            className="flex items-center gap-2 px-1 py-3 text-[10px] text-[#8a8f94] dark:text-muted-foreground"
            data-usage-session-state={session.status}
          >
            {session.status === "loading" ? <LoaderCircle aria-hidden className="size-3 animate-spin" /> : null}
            {t(session.status === "failed" ? "turnUsageSessionFailed" : "turnUsageSessionLoading")}
          </div>
        ) : (
          <UsagePanel
            extras={extras}
            latency={scope === "turn" ? latency : undefined}
            summary={summary ?? turnSummary}
            title={t(scope === "session" ? "turnUsageSessionTitle" : "turnUsagePanelTitle")}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
