import { Button, Dialog, DialogContent, DialogTitle } from "@wordless/ui-kit";
import { LoaderCircle, MessageSquare, RotateCcw, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { SessionMessageSearchRequest, SessionMessageSearchResponse, SessionMessageSearchResult, SessionMessageSearchRole } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";

type SearchFilter = "all" | SessionMessageSearchRole;

type ConversationSearchDialogProps = {
  onNavigate: (result: SessionMessageSearchResult) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  searchMessages: (request: SessionMessageSearchRequest) => Promise<SessionMessageSearchResponse>;
  sessionId: string;
};

const SEARCH_DEBOUNCE_MS = 180;

function ResultSnippet({ result }: { result: SessionMessageSearchResult }) {
  return <span>{result.snippet.slice(0, result.matchStart)}<mark className="rounded-[2px] bg-[#e4ebc5] px-px text-inherit dark:bg-[#586734]">{result.snippet.slice(result.matchStart, result.matchEnd)}</mark>{result.snippet.slice(result.matchEnd)}</span>;
}

function resultTimestamp(timestamp: number, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

export function ConversationSearchDialog({ onNavigate, onOpenChange, open, searchMessages, sessionId }: ConversationSearchDialogProps) {
  const { locale, reduceMotion, t } = usePreferences();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [response, setResponse] = useState<SessionMessageSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    setQuery("");
    setFilter("all");
    setResponse(null);
    setError(null);
    setSelectedIndex(0);
    setRetryVersion(0);
  }, [sessionId]);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    const sequence = ++requestSequenceRef.current;
    if (!open || !normalizedQuery) {
      setLoading(false);
      setResponse(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setResponse(null);
    setSelectedIndex(0);
    const timeout = window.setTimeout(() => {
      void searchMessages({ query: normalizedQuery, role: filter === "all" ? undefined : filter, limit: 50 }).then((nextResponse) => {
        if (sequence !== requestSequenceRef.current) return;
        setResponse(nextResponse);
        setSelectedIndex(0);
      }).catch((cause: unknown) => {
        if (sequence !== requestSequenceRef.current) return;
        setResponse(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => {
        if (sequence === requestSequenceRef.current) setLoading(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [filter, open, query, retryVersion, searchMessages]);

  useEffect(() => {
    resultRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [reduceMotion, response?.results.length, selectedIndex]);

  const results = response?.results ?? [];
  const select = (result: SessionMessageSearchResult) => {
    onNavigate(result);
    onOpenChange(false);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((current) => Math.min(current + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const result = results[selectedIndex];
      if (result) select(result);
    }
  };
  const roleLabel = (role: SessionMessageSearchRole) => role === "user" ? (locale === "zh-CN" ? "我" : "You") : t("assistantName");
  const summary = response ? (locale === "zh-CN" ? `找到 ${response.total} 条消息` : `${response.total} message${response.total === 1 ? "" : "s"} found`) : null;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent aria-describedby={undefined} className="flex h-[min(76vh,46rem)] w-[min(47.5rem,calc(100vw-2rem))] flex-col rounded-[10px] border-[#d9d9d4] bg-[#fcfcfa] p-0 shadow-[0_20px_55px_rgba(20,20,17,0.18)] dark:border-border dark:bg-card" onKeyDown={onKeyDown} showCloseButton={false}>
        <DialogTitle className="sr-only">{t("messageSearch")}</DialogTitle>
        <div className="flex shrink-0 items-center gap-2 border-b border-[#e7e7e2] px-4 py-3 dark:border-border">
          <Search aria-hidden className="h-4 w-4 shrink-0 text-[#777771] dark:text-muted-foreground" />
          <label className="sr-only" htmlFor="conversation-message-search">{t("messageSearch")}</label>
          <input autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[14px] text-[#30302d] outline-none placeholder:text-[#96968f] dark:text-foreground" id="conversation-message-search" onChange={(event) => setQuery(event.target.value)} placeholder={t("messageSearchPlaceholder")} ref={inputRef} value={query} />
          {loading ? <LoaderCircle aria-label={locale === "zh-CN" ? "正在搜索" : "Searching"} className="h-4 w-4 shrink-0 animate-spin text-[#6f8250]" /> : null}
          {query ? <Button aria-label={locale === "zh-CN" ? "清除搜索" : "Clear search"} className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-[#f0f0ed] hover:text-foreground dark:hover:bg-muted" onClick={() => setQuery("")} size="icon" type="button" variant="ghost"><X className="h-3.5 w-3.5" /></Button> : null}
          <Button aria-label={locale === "zh-CN" ? "关闭搜索" : "Close search"} className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-[#f0f0ed] hover:text-foreground dark:hover:bg-muted" onClick={() => onOpenChange(false)} size="icon" type="button" variant="ghost"><X className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#edede9] px-4 py-2 dark:border-border">
          <div aria-label={locale === "zh-CN" ? "消息筛选" : "Message filter"} className="inline-flex items-center rounded-[6px] bg-[#f1f1ee] p-0.5 dark:bg-muted" role="group">
            {(["all", "user", "assistant"] as const).map((value) => {
              const label = value === "all" ? (locale === "zh-CN" ? "全部" : "All") : roleLabel(value);
              const active = filter === value;
              return <button aria-pressed={active} className={`h-6 rounded-[4px] px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "bg-white text-[#353531] shadow-[0_1px_2px_rgba(20,20,17,0.10)] dark:bg-card dark:text-foreground" : "text-[#74746d] hover:text-[#3e3e39] dark:text-muted-foreground dark:hover:text-foreground"}`} key={value} onClick={() => setFilter(value)} type="button">{label}</button>;
            })}
          </div>
          <p aria-live="polite" className="shrink-0 text-[11px] text-[#85857e] dark:text-muted-foreground">{summary}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {!query.trim() ? <div className="grid min-h-full place-items-center px-6 text-center"><div><Search aria-hidden className="mx-auto h-5 w-5 text-[#a0a099] dark:text-muted-foreground" /><p className="mt-3 text-[13px] font-medium text-[#565650] dark:text-foreground">{t("messageSearch")}</p><p className="mt-1 text-[12px] leading-5 text-[#85857e] dark:text-muted-foreground">{t("messageSearchHint")}</p></div></div> : error ? <div className="grid min-h-full place-items-center px-6 text-center"><div><p className="text-[13px] font-medium text-[#565650] dark:text-foreground">{t("messageSearchFailed")}</p><p className="mt-1 max-w-[420px] text-[12px] leading-5 text-[#85857e] dark:text-muted-foreground">{error}</p><Button className="mt-4 h-8 gap-1.5 px-2.5 text-[11px]" onClick={() => setRetryVersion((current) => current + 1)} type="button" variant="outline"><RotateCcw className="h-3.5 w-3.5" />{t("retry")}</Button></div></div> : !loading && response && results.length === 0 ? <div className="grid min-h-full place-items-center px-6 text-center"><div><MessageSquare aria-hidden className="mx-auto h-5 w-5 text-[#a0a099] dark:text-muted-foreground" /><p className="mt-3 text-[13px] font-medium text-[#565650] dark:text-foreground">{t("messageSearchNoResults")}</p><p className="mt-1 text-[12px] leading-5 text-[#85857e] dark:text-muted-foreground">{t("messageSearchNoResultsHint")}</p></div></div> : <div role="listbox">{results.map((result, index) => <button aria-selected={selectedIndex === index} className={`block w-full border-l-2 px-4 py-3 text-left outline-none transition-colors focus-visible:bg-[#f2f5e8] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-ring dark:focus-visible:bg-muted ${selectedIndex === index ? "border-[#94a863] bg-[#f5f7ee] dark:border-[#b0c87a] dark:bg-muted" : "border-transparent hover:bg-[#f7f7f4] dark:hover:bg-muted/60"}`} key={result.messageId} onClick={() => select(result)} onMouseEnter={() => setSelectedIndex(index)} ref={(element) => { resultRefs.current[index] = element; }} role="option" type="button"><div className="flex min-w-0 items-center gap-2"><span className={`shrink-0 text-[11px] font-semibold ${result.role === "user" ? "text-[#5d746e] dark:text-[#9bc5bb]" : "text-[#6a7948] dark:text-[#c1d88b]"}`}>{roleLabel(result.role)}</span><span className="truncate text-[11px] text-[#909089] dark:text-muted-foreground">{resultTimestamp(result.timestamp, locale)}</span></div><p className="mt-1 line-clamp-2 text-[12px] leading-5 text-[#4d4d47] dark:text-foreground" title={result.snippet}><ResultSnippet result={result} /></p></button>)}</div>}
        </div>
        {response?.truncated ? <p className="shrink-0 border-t border-[#edede9] px-4 py-2 text-[11px] text-[#85857e] dark:border-border dark:text-muted-foreground">{t("messageSearchTruncated")}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
