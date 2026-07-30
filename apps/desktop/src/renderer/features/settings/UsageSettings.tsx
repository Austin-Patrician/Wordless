import * as Popover from "@radix-ui/react-popover";
import { Button } from "@wordless/ui-kit";
import { AlertCircle, ArrowDownUp, CalendarDays, ChartLine, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProviderAvatarId, UsageAggregate, UsageBucket, UsageGroup, UsageMetric, UsageReport } from "@wordless/domain";
import { ProviderIcon } from "./provider-icons";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";

type UsageRangePreset = "1d" | "7d" | "14d" | "30d";
type UsageRange = { startAt: number; endAt: number };
type SortKey = "name" | "requestCount" | "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens" | "totalTokens" | "estimatedCost";
type SortDirection = "ascending" | "descending";
type TrendDatum = { timestamp: number; [key: string]: number };
type TrendSeries = { key: string; label: string; color: string; groupKeys: string[] };

const PRESET_DURATIONS: Record<UsageRangePreset, number> = {
  "1d": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "14d": 14 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

const TREND_COLORS = ["#52653d", "#bd7a4b", "#4b7c83", "#9a5e69", "#7b7198", "#7d8350"];

function rangeForPreset(preset: UsageRangePreset): UsageRange {
  const endAt = Date.now();
  return { startAt: endAt - PRESET_DURATIONS[preset], endAt };
}

function metricValue(usage: UsageAggregate, metric: UsageMetric): number {
  if (metric === "cost") return usage.estimatedCost;
  if (metric === "requests") return usage.requestCount;
  return usage.totalTokens;
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

function formatCompactNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatCost(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: value < 1 ? 4 : 2 }).format(value);
}

function formatMetric(value: number, metric: UsageMetric, locale: string): string {
  if (metric === "cost") return formatCost(value, locale);
  if (metric === "requests") return formatNumber(value, locale);
  return formatCompactNumber(value, locale);
}

function formatDateTimeInput(value: number): string {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatRange(range: UsageRange, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  return `${formatter.format(range.startAt)} - ${formatter.format(range.endAt)}`;
}

function formatBucket(value: number, bucket: UsageBucket, locale: string): string {
  const options: Intl.DateTimeFormatOptions = bucket === "hour"
    ? { month: "numeric", day: "numeric", hour: "2-digit" }
    : bucket === "month"
      ? { year: "numeric", month: "short" }
      : { month: "numeric", day: "numeric" };
  return new Intl.DateTimeFormat(locale, options).format(value);
}

function formatFullDate(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value);
}

function displayIdentifier(value: string): string {
  return value.split(/[-_/.]+/).filter(Boolean).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" ") || value;
}

function groupName(group: UsageGroup, providers: ReadonlyMap<string, string>): string {
  if (group.modelId) return group.modelId;
  return providers.get(group.providerId) ?? displayIdentifier(group.providerId);
}

function groupKindLabel(group: UsageGroup, chatLabel: string, imageLabel: string): string {
  if (group.modelKind === "chat") return chatLabel;
  if (group.modelKind === "image") return imageLabel;
  return `${chatLabel} + ${imageLabel}`;
}

export function UsageSettings() {
  const client = useRuntimeClient();
  const { snapshot } = useRuntime();
  const { locale, t } = usePreferences();
  const [groupBy, setGroupBy] = useState<"provider" | "model">("provider");
  const [metric, setMetric] = useState<UsageMetric>("cost");
  const [preset, setPreset] = useState<UsageRangePreset | null>("7d");
  const [range, setRange] = useState<UsageRange>(() => rangeForPreset("7d"));
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "estimatedCost", direction: "descending" });

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await client.getUsageReport({ ...range, groupBy });
        if (!disposed) setReport(next);
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => { disposed = true; };
  }, [client, groupBy, range.endAt, range.startAt, refreshVersion]);

  const providerNames = useMemo(() => new Map((snapshot?.modelConfiguration.providers ?? []).map((provider) => [provider.id, provider.displayName])), [snapshot?.modelConfiguration.providers]);
  const providerAvatars = useMemo(() => new Map((snapshot?.modelConfiguration.providers ?? []).map((provider) => [`${provider.kind}:${provider.id}`, provider.avatarId])), [snapshot?.modelConfiguration.providers]);
  const sortedGroups = useMemo(() => {
    if (!report) return [];
    return [...report.groups].sort((left, right) => {
      const leftValue = sort.key === "name" ? groupName(left, providerNames) : left.usage[sort.key];
      const rightValue = sort.key === "name" ? groupName(right, providerNames) : right.usage[sort.key];
      const compared = typeof leftValue === "string" && typeof rightValue === "string"
        ? leftValue.localeCompare(rightValue, locale)
        : Number(leftValue) - Number(rightValue);
      return sort.direction === "ascending" ? compared : -compared;
    });
  }, [locale, providerNames, report, sort]);
  const trend = useMemo(() => report ? buildTrend(report, metric, providerNames, t("usageOther")) : { data: [], series: [] }, [metric, providerNames, report, t]);

  const choosePreset = (nextPreset: UsageRangePreset) => {
    setPreset(nextPreset);
    setRange(rangeForPreset(nextPreset));
  };

  const toggleSort = (key: SortKey) => {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" }
      : { key, direction: key === "name" ? "ascending" : "descending" });
  };

  return (
    <section className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-9">
      <div className="mx-auto max-w-[820px] pb-6">
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-[7px] border border-[#d9d9d3] bg-[#f6f6f3] p-0.5 dark:border-border dark:bg-[#24261f]" role="tablist" aria-label={t("usage")}>
              <UsageTab active={groupBy === "provider"} label={t("usageProviders")} onClick={() => setGroupBy("provider")} />
              <UsageTab active={groupBy === "model"} label={t("usageModels")} onClick={() => setGroupBy("model")} />
            </div>
            <Button aria-label={t("usageRefresh")} className="border border-[#deded8] bg-white text-[#606058] hover:bg-[#f4f4f0] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-muted" disabled={loading} onClick={() => setRefreshVersion((value) => value + 1)} size="icon" title={t("usageRefresh")} type="button" variant="ghost">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-[7px] border border-[#deded8] bg-white p-0.5 dark:border-border dark:bg-card" role="tablist" aria-label={t("usageTrend")}>
              <UsageTab active={metric === "cost"} label={t("usageMetricCost")} onClick={() => setMetric("cost")} />
              <UsageTab active={metric === "tokens"} label={t("usageMetricTokens")} onClick={() => setMetric("tokens")} />
              <UsageTab active={metric === "requests"} label={t("usageMetricRequests")} onClick={() => setMetric("requests")} />
            </div>
            <UsageRangePicker onPreset={choosePreset} onRange={(nextRange) => { setPreset(null); setRange(nextRange); }} preset={preset} range={range} />
          </div>
        </div>

        {loading && !report ? <UsageLoading /> : null}
        {error && !report ? <UsageError error={error} onRetry={() => setRefreshVersion((value) => value + 1)} /> : null}
        {report ? <>
          {error ? <div className="mt-4 flex items-center justify-between gap-3 rounded-[8px] border border-[#e7ccc1] bg-[#fcf5f1] px-3 py-2 text-[11px] text-[#9c5947] dark:border-[#674138] dark:bg-[#2d211d] dark:text-[#e8b3a4]"><span className="min-w-0 truncate">{error}</span><button className="shrink-0 font-semibold underline underline-offset-2" onClick={() => setRefreshVersion((value) => value + 1)} type="button">{t("usageRetry")}</button></div> : null}
          <UsageSummary report={report} locale={locale} />
          {report.groups.length === 0 ? <UsageEmpty /> : <>
            <section className="mt-5 border-y border-border py-4">
              <div className="flex items-center justify-between gap-3"><div><h2 className="text-[13px] font-semibold">{t("usageTrend")}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{formatRange(range, locale)}</p></div><span className="font-mono text-[10px] text-muted-foreground">{metric === "cost" ? t("usageMetricCost") : metric === "tokens" ? t("usageMetricTokens") : t("usageMetricRequests")}</span></div>
              <div className="mt-4 h-[205px] w-full" role="img" aria-label={t("usageTrend")}>
                <ResponsiveContainer height="100%" width="100%">
                  <LineChart data={trend.data} margin={{ top: 6, right: 4, bottom: 0, left: -10 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="2 3" vertical={false} />
                    <XAxis axisLine={false} dataKey="timestamp" fontSize={10} minTickGap={28} tick={{ fill: "var(--muted-foreground)" }} tickFormatter={(value) => formatBucket(Number(value), report.bucket, locale)} tickLine={false} />
                    <YAxis axisLine={false} fontSize={10} tick={{ fill: "var(--muted-foreground)" }} tickFormatter={(value) => formatMetric(Number(value), metric, locale)} tickLine={false} width={60} />
                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 7, boxShadow: "0 10px 28px rgba(0,0,0,0.12)", fontSize: 11 }} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} formatter={(value) => formatMetric(Number(value), metric, locale)} labelFormatter={(value) => formatFullDate(Number(value), locale)} />
                    {trend.series.map((series) => <Line activeDot={{ r: 3 }} dataKey={series.key} dot={false} key={series.key} name={series.label} stroke={series.color} strokeWidth={2} type="monotone" />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5" aria-label={t("usageTrend")}>
                {trend.series.map((series) => <span className="inline-flex max-w-[170px] items-center gap-1.5 text-[10px] text-muted-foreground" key={series.key}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: series.color }} /><span className="truncate">{series.label}</span></span>)}
              </div>
            </section>
            <section className="mt-5">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-[13px] font-semibold">{t("usageDetails")}</h2><span className="font-mono text-[10px] text-muted-foreground">{formatNumber(report.groups.length, locale)}</span></div>
              <div className="overflow-x-auto rounded-[8px] border border-[#e3e3de] bg-white dark:border-border dark:bg-card">
                <table className="min-w-[720px] w-full border-collapse text-left">
                  <thead className="border-b border-[#e8e8e2] bg-[#fafaf8] text-[10px] font-medium text-muted-foreground dark:border-border dark:bg-[#22241c]">
                    <tr>
                      <UsageTableHeader active={sort.key === "name"} direction={sort.direction} label={t("usageName")} onClick={() => toggleSort("name")} />
                      <UsageTableHeader active={sort.key === "requestCount"} direction={sort.direction} label={t("usageRequests")} onClick={() => toggleSort("requestCount")} numeric />
                      <UsageTableHeader active={sort.key === "inputTokens"} direction={sort.direction} label={t("usageInput")} onClick={() => toggleSort("inputTokens")} numeric />
                      <UsageTableHeader active={sort.key === "outputTokens"} direction={sort.direction} label={t("usageOutput")} onClick={() => toggleSort("outputTokens")} numeric />
                      <UsageTableHeader active={sort.key === "cacheReadTokens"} direction={sort.direction} label={t("usageCacheRead")} onClick={() => toggleSort("cacheReadTokens")} numeric />
                      <UsageTableHeader active={sort.key === "cacheWriteTokens"} direction={sort.direction} label={t("usageCacheWrite")} onClick={() => toggleSort("cacheWriteTokens")} numeric />
                      <UsageTableHeader active={sort.key === "totalTokens"} direction={sort.direction} label={t("usageTotalTokens")} onClick={() => toggleSort("totalTokens")} numeric />
                      <UsageTableHeader active={sort.key === "estimatedCost"} direction={sort.direction} label={t("usageEstimatedCost")} onClick={() => toggleSort("estimatedCost")} numeric />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#eeeeea] dark:divide-border">
                    {sortedGroups.map((group) => <UsageTableRow avatarId={group.modelKind === "mixed" ? providerAvatars.get(`chat:${group.providerId}`) ?? providerAvatars.get(`image:${group.providerId}`) : providerAvatars.get(`${group.modelKind}:${group.providerId}`)} chatLabel={t("usageChat")} group={group} imageLabel={t("usageImage")} key={group.key} locale={locale} name={groupName(group, providerNames)} />)}
                  </tbody>
                </table>
              </div>
            </section>
          </>}
        </> : null}
      </div>
    </section>
  );
}

function buildTrend(report: UsageReport, metric: UsageMetric, providers: ReadonlyMap<string, string>, otherLabel: string): { data: TrendDatum[]; series: TrendSeries[] } {
  const ranked = [...report.groups].sort((left, right) => metricValue(right.usage, metric) - metricValue(left.usage, metric));
  const visibleGroups = ranked.slice(0, 5);
  const hiddenGroups = ranked.slice(5);
  const series: TrendSeries[] = visibleGroups.map((group, index) => ({ key: group.key, label: groupName(group, providers), color: TREND_COLORS[index]!, groupKeys: [group.key] }));
  if (hiddenGroups.length > 0) series.push({ key: "__other__", label: otherLabel, color: TREND_COLORS[visibleGroups.length]!, groupKeys: hiddenGroups.map((group) => group.key) });
  const data = report.trend.map((point) => {
    const values = new Map(point.values.map((value) => [value.groupKey, value.usage]));
    const datum: TrendDatum = { timestamp: point.startAt };
    for (const item of series) datum[item.key] = item.groupKeys.reduce((total, key) => total + metricValue(values.get(key) ?? EMPTY_USAGE, metric), 0);
    return datum;
  });
  return { data, series };
}

const EMPTY_USAGE: UsageAggregate = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  estimatedCost: 0,
  requestCount: 0,
  incompleteUsageCount: 0,
  unmeteredOperationCount: 0,
};

function UsageTab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button aria-pressed={active} className={`h-7 rounded-[5px] px-2.5 text-[10px] font-medium transition-colors ${active ? "bg-[#30312e] text-white shadow-sm dark:bg-[#d8ef79] dark:text-[#202610]" : "text-[#6e6e66] hover:bg-[#ecece7] dark:text-muted-foreground dark:hover:bg-muted"}`} onClick={onClick} role="tab" type="button">{label}</button>;
}

function UsageRangePicker({ onPreset, onRange, preset, range }: { onPreset: (preset: UsageRangePreset) => void; onRange: (range: UsageRange) => void; preset: UsageRangePreset | null; range: UsageRange }) {
  const { locale, t } = usePreferences();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(() => formatDateTimeInput(range.startAt));
  const [end, setEnd] = useState(() => formatDateTimeInput(range.endAt));
  const [error, setError] = useState<string | null>(null);
  const labels: Record<UsageRangePreset, string> = { "1d": t("usageRange1d"), "7d": t("usageRange7d"), "14d": t("usageRange14d"), "30d": t("usageRange30d") };

  const setPopoverOpen = (next: boolean) => {
    if (next) {
      setStart(formatDateTimeInput(range.startAt));
      setEnd(formatDateTimeInput(range.endAt));
      setError(null);
    }
    setOpen(next);
  };

  const applyRange = () => {
    const startAt = new Date(start).getTime();
    const endAt = new Date(end).getTime();
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
      setError(t("usageInvalidRange"));
      return;
    }
    onRange({ startAt, endAt });
    setOpen(false);
  };

  return <div className="flex items-center gap-1.5"><div className="inline-flex rounded-[7px] border border-[#deded8] bg-white p-0.5 dark:border-border dark:bg-card">{(Object.keys(PRESET_DURATIONS) as UsageRangePreset[]).map((item) => <UsageTab active={preset === item} key={item} label={labels[item]} onClick={() => onPreset(item)} />)}</div><Popover.Root onOpenChange={setPopoverOpen} open={open}><Popover.Trigger asChild><Button aria-label={t("usageCustomRange")} className={`border ${preset === null ? "border-[#7f9157] bg-[#f6f8ee] text-[#43502d] dark:border-[#b7d85a] dark:bg-[#293019] dark:text-[#d8ef79]" : "border-[#deded8] bg-white text-[#61615a] dark:border-border dark:bg-card dark:text-muted-foreground"}`} size="icon" title={preset === null ? formatRange(range, locale) : t("usageCustomRange")} type="button" variant="ghost"><CalendarDays className="h-3.5 w-3.5" /></Button></Popover.Trigger><Popover.Portal><Popover.Content align="end" className="z-[80] w-[290px] rounded-[9px] border border-[#deded8] bg-white p-3.5 shadow-[0_18px_42px_rgba(0,0,0,0.16)] outline-none dark:border-border dark:bg-[#202219]" side="bottom" sideOffset={8}><div className="flex items-center justify-between"><p className="text-[12px] font-semibold">{t("usageCustomRange")}</p><span className="font-mono text-[9px] text-muted-foreground">{formatRange(range, locale)}</span></div><label className="mt-3 block"><span className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("usageStart")}</span><input className="h-8 w-full rounded-[5px] border border-input bg-background px-2 text-[10px] outline-none focus:border-[#83965a] dark:bg-[#181912]" onChange={(event) => setStart(event.target.value)} type="datetime-local" value={start} /></label><label className="mt-2.5 block"><span className="mb-1 block text-[10px] font-medium text-muted-foreground">{t("usageEnd")}</span><input className="h-8 w-full rounded-[5px] border border-input bg-background px-2 text-[10px] outline-none focus:border-[#83965a] dark:bg-[#181912]" onChange={(event) => setEnd(event.target.value)} type="datetime-local" value={end} /></label>{error ? <p className="mt-2 text-[10px] text-[#a25a48] dark:text-[#e4a18e]" role="alert">{error}</p> : null}<div className="mt-3 flex justify-end"><Button className="h-8 px-3 text-[10px]" onClick={applyRange} type="button">{t("usageApplyRange")}</Button></div></Popover.Content></Popover.Portal></Popover.Root></div>;
}

function UsageSummary({ locale, report }: { locale: string; report: UsageReport }) {
  const { t } = usePreferences();
  return <section className="mt-5 divide-y divide-border border-y border-border"><div className="grid grid-cols-2 divide-x divide-border sm:grid-cols-4"><UsageStat label={t("usageEstimatedCost")} value={formatCost(report.totals.estimatedCost, locale)} /><UsageStat label={t("usageTotalTokens")} value={formatCompactNumber(report.totals.totalTokens, locale)} /><UsageStat label={t("usageRequests")} value={formatNumber(report.totals.requestCount, locale)} /><UsageStat label={t("usageCacheRead")} value={formatCompactNumber(report.totals.cacheReadTokens, locale)} /></div>{report.totals.unmeteredOperationCount > 0 ? <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-muted-foreground"><AlertCircle className="h-3 w-3 shrink-0 text-[#ad7956] dark:text-[#d6a16d]" />{t("usageUnmetered").replace("{count}", formatNumber(report.totals.unmeteredOperationCount, locale))}</div> : null}</section>;
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 px-3 py-3 first:pl-0 last:pr-0"><p className="truncate text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-[14px] font-semibold tabular-nums text-foreground">{value}</p></div>;
}

function UsageLoading() {
  const { t } = usePreferences();
  return <div className="grid min-h-[240px] place-items-center text-center"><div><LoaderCircle className="mx-auto h-4 w-4 animate-spin text-[#718053] dark:text-[#c7dd86]" /><p className="mt-2 text-[11px] text-muted-foreground">{t("usageLoading")}</p></div></div>;
}

function UsageError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = usePreferences();
  return <div className="grid min-h-[240px] place-items-center text-center"><div><AlertCircle className="mx-auto h-4 w-4 text-[#b46a57] dark:text-[#e0a28f]" /><p className="mt-2 text-[12px] font-medium">{t("usageLoadFailed")}</p><p className="mt-1 max-w-[360px] text-[11px] text-muted-foreground">{error}</p><Button className="mt-3 h-8 px-3 text-[10px]" onClick={onRetry} type="button">{t("usageRetry")}</Button></div></div>;
}

function UsageEmpty() {
  const { t } = usePreferences();
  return <div className="grid min-h-[250px] place-items-center border-b border-border text-center"><div><ChartLine className="mx-auto h-4 w-4 text-muted-foreground" strokeWidth={1.5} /><p className="mt-2 text-[11px] text-muted-foreground">{t("usageNoData")}</p></div></div>;
}

function UsageTableHeader({ active, direction, label, numeric = false, onClick }: { active: boolean; direction: SortDirection; label: string; numeric?: boolean; onClick: () => void }) {
  return <th aria-sort={active ? direction : "none"} className={`h-9 px-2.5 font-medium ${numeric ? "text-right" : "text-left"}`} scope="col"><button className={`inline-flex items-center gap-1 ${numeric ? "justify-end" : ""} ${active ? "text-foreground" : "hover:text-foreground"}`} onClick={onClick} type="button"><span>{label}</span><ArrowDownUp className={`h-2.5 w-2.5 ${active ? "opacity-100" : "opacity-35"}`} /></button></th>;
}

function UsageTableRow({ avatarId, chatLabel, group, imageLabel, locale, name }: { avatarId: ProviderAvatarId | null | undefined; chatLabel: string; group: UsageGroup; imageLabel: string; locale: string; name: string }) {
  const cells = [group.usage.requestCount, group.usage.inputTokens, group.usage.outputTokens, group.usage.cacheReadTokens, group.usage.cacheWriteTokens, group.usage.totalTokens];
  return <tr className="text-[10px] text-[#595951] hover:bg-[#fafaf7] dark:text-[#d7d9ce] dark:hover:bg-muted/40"><td className="max-w-[190px] px-2.5 py-2.5"><div className="flex min-w-0 items-center gap-2"><ProviderIcon avatarId={avatarId} className="h-4 w-4 shrink-0" providerId={group.providerId} /><div className="min-w-0"><p className="truncate font-medium text-foreground" title={name}>{name}</p><p className="mt-0.5 truncate text-[9px] text-muted-foreground">{groupKindLabel(group, chatLabel, imageLabel)} · {group.providerId}</p></div></div></td>{cells.map((value, index) => <td className="px-2.5 py-2.5 text-right font-mono tabular-nums" key={index}>{formatCompactNumber(value, locale)}</td>)}<td className="px-2.5 py-2.5 text-right font-mono tabular-nums text-[#53673a] dark:text-[#cbe27f]">{formatCost(group.usage.estimatedCost, locale)}</td></tr>;
}
