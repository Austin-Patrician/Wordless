import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import mermaid from "mermaid";
import { Check, ChevronDown, ChevronUp, Code2, Copy, ImageOff, LoaderCircle, Maximize2, Minus, Plus, RotateCcw, TextWrap, X } from "lucide-react";
import { Children, isValidElement, memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentPropsWithoutRef, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Dialog, DialogContent, DialogTitle, Tooltip, TooltipContent, TooltipTrigger, cn } from "@wordless/ui-kit";
import { usePreferences } from "../../shared/preferences";
import { useRuntimeClient } from "../../shared/runtime";
import { remarkWordlessMath } from "./message-markdown-math";
import { codeLanguageLabel, hasClosedCodeFence, isOversizedMermaid, markdownUrlTransform, normalizeCodeLanguage, safeExternalUrl, safeRemoteImageUrl } from "./message-markdown-policy";
import "katex/dist/katex.min.css";
import "./message-markdown.css";

const HIGHLIGHT_LANGUAGES = { bash, c, cpp, csharp, css, diff, go, java, javascript, json, markdown, powershell, python, rust, sql, typescript, xml, yaml };
for (const [name, definition] of Object.entries(HIGHLIGHT_LANGUAGES)) hljs.registerLanguage(name, definition);

let mermaidRenderSequence = 0;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

type MermaidTheme = "default" | "dark";

function renderMermaid(source: string, theme: MermaidTheme): Promise<string> {
  const id = `wordless-mermaid-${++mermaidRenderSequence}`;
  let resolveResult: (value: string) => void;
  let rejectResult: (reason: unknown) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  mermaidRenderQueue = mermaidRenderQueue.catch(() => undefined).then(async () => {
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        secure: ["securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "themeCSS", "themeVariables", "fontFamily"],
        suppressErrorRendering: true,
        maxTextSize: 20_000,
        theme,
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      });
      const rendered = await mermaid.render(id, source);
      resolveResult(sanitizeMermaidSvg(rendered.svg));
    } catch (error) {
      rejectResult(error);
    }
  });
  return result;
}

function sanitizeMermaidSvg(svg: string): string {
  const documentValue = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (documentValue.querySelector("parsererror")) throw new Error("Mermaid returned invalid SVG");
  for (const element of documentValue.querySelectorAll("script, iframe, object, embed")) element.remove();
  for (const element of documentValue.querySelectorAll("*")) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "href" || name === "xlink:href" || name === "target") element.removeAttribute(attribute.name);
    }
  }
  return new XMLSerializer().serializeToString(documentValue.documentElement);
}

function useResolvedTheme(): MermaidTheme {
  const [theme, setTheme] = useState<MermaidTheme>(() => document.documentElement.dataset.theme === "dark" ? "dark" : "default");
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setTheme(root.dataset.theme === "dark" ? "dark" : "default");
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    update();
    return () => observer.disconnect();
  }, []);
  return theme;
}

function childText(children: ReactNode): string {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    if (isValidElement<{ children?: ReactNode }>(child)) return childText(child.props.children);
    return "";
  }).join("");
}

function useCopyFeedback(value: string): { copied: boolean; copy: () => Promise<void> } {
  const [copied, setCopied] = useState(false);
  const resetRef = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    if (resetRef.current !== undefined) window.clearTimeout(resetRef.current);
  }, []);
  return {
    copied,
    copy: async () => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (resetRef.current !== undefined) window.clearTimeout(resetRef.current);
        resetRef.current = window.setTimeout(() => setCopied(false), 1_500);
      } catch {
        setCopied(false);
      }
    },
  };
}

function IconAction({ active = false, disabled = false, label, onClick, children }: { active?: boolean; disabled?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild><button aria-label={label} className={cn("grid h-7 w-7 place-items-center rounded-[5px] text-[#74746d] transition-colors hover:bg-[#ecece8] hover:text-[#343430] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35 dark:text-muted-foreground dark:hover:bg-[#34362f] dark:hover:text-foreground", active && "bg-[#e8ebe2] text-[#4e6238] dark:bg-[#3b422e] dark:text-[#d1e79b]")} disabled={disabled} onClick={onClick} type="button">{children}</button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const { locale } = usePreferences();
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(false);
  const { copied, copy } = useCopyFeedback(code);
  const normalizedLanguage = normalizeCodeLanguage(language);
  const highlighted = useMemo(() => {
    if (!hljs.getLanguage(normalizedLanguage)) return null;
    return hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value;
  }, [code, normalizedLanguage]);
  const long = code.length > 1_600 || code.split(/\r?\n/).length > 16;
  return (
    <section className="message-code-block my-4 overflow-hidden rounded-[7px] border border-[#deded9] bg-[#fafaf8] dark:border-border dark:bg-[#1b1d19]">
      <header className="flex h-8 items-center border-b border-[#e5e5e0] bg-[#f3f3f0] pl-3 pr-1 dark:border-border dark:bg-[#252722]">
        <Code2 className="mr-1.5 h-3.5 w-3.5 text-[#78836d] dark:text-[#aebf91]" />
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium text-[#696963] dark:text-muted-foreground">{codeLanguageLabel(normalizedLanguage)}</span>
        <IconAction active={wrap} label={locale === "zh-CN" ? "切换自动换行" : "Toggle line wrapping"} onClick={() => setWrap((value) => !value)}><TextWrap className="h-3.5 w-3.5" /></IconAction>
        <IconAction label={copied ? locale === "zh-CN" ? "已复制" : "Copied" : locale === "zh-CN" ? "复制代码" : "Copy code"} onClick={() => void copy()}>{copied ? <Check className="h-3.5 w-3.5 text-[#66833d]" /> : <Copy className="h-3.5 w-3.5" />}</IconAction>
      </header>
      <pre className={cn("message-code-scroll m-0 overflow-auto px-3 py-3 font-mono text-[12px] leading-5 text-[#42423e] dark:text-[#d8dbd2]", !expanded && long && "max-h-96", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}><code className="hljs" dangerouslySetInnerHTML={highlighted === null ? undefined : { __html: highlighted }}>{highlighted === null ? code : undefined}</code></pre>
      {long ? <div className="flex h-7 items-center justify-center border-t border-[#e5e5e0] dark:border-border"><IconAction label={expanded ? locale === "zh-CN" ? "收起代码" : "Collapse code" : locale === "zh-CN" ? "展开代码" : "Expand code"} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</IconAction></div> : null}
    </section>
  );
}

function MermaidCanvas({ svg }: { svg: string }) {
  return <div className="message-mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function MermaidFullscreen({ open, onOpenChange, source, svg }: { open: boolean; onOpenChange: (open: boolean) => void; source: string; svg: string }) {
  const { locale } = usePreferences();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const { copied, copy } = useCopyFeedback(source);
  const reset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const changeZoom = (value: number) => setZoom(Math.max(0.4, Math.min(3, value)));
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    setPan({ x: dragRef.current.panX + event.clientX - dragRef.current.x, y: dragRef.current.panY + event.clientY - dragRef.current.y });
  };
  const wheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeZoom(zoom + (event.deltaY > 0 ? -0.1 : 0.1));
  };
  return <Dialog onOpenChange={(nextOpen) => { if (!nextOpen) reset(); onOpenChange(nextOpen); }} open={open}><DialogContent aria-describedby={undefined} className="flex h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col rounded-[8px] bg-[#f5f5f2] p-0 dark:bg-[#171914]" onKeyDown={(event) => { if (event.key === "+" || event.key === "=") changeZoom(zoom + 0.1); if (event.key === "-") changeZoom(zoom - 0.1); if (event.key === "0") reset(); }} showCloseButton={false}><DialogTitle className="sr-only">Mermaid diagram</DialogTitle><header className="flex h-11 shrink-0 items-center border-b border-[#dfdfda] px-3 dark:border-border"><span className="font-mono text-[11px] font-semibold text-[#555550] dark:text-foreground">Mermaid</span><span className="ml-2 font-mono text-[9px] tabular-nums text-muted-foreground">{Math.round(zoom * 100)}%</span><div className="ml-auto flex items-center gap-0.5"><IconAction label={locale === "zh-CN" ? "缩小" : "Zoom out"} onClick={() => changeZoom(zoom - 0.1)}><Minus className="h-3.5 w-3.5" /></IconAction><IconAction label={locale === "zh-CN" ? "适应视图" : "Fit view"} onClick={reset}><RotateCcw className="h-3.5 w-3.5" /></IconAction><IconAction label={locale === "zh-CN" ? "放大" : "Zoom in"} onClick={() => changeZoom(zoom + 0.1)}><Plus className="h-3.5 w-3.5" /></IconAction><IconAction label={copied ? locale === "zh-CN" ? "已复制" : "Copied" : locale === "zh-CN" ? "复制源码" : "Copy source"} onClick={() => void copy()}>{copied ? <Check className="h-3.5 w-3.5 text-[#66833d]" /> : <Copy className="h-3.5 w-3.5" />}</IconAction><IconAction label={locale === "zh-CN" ? "关闭" : "Close"} onClick={() => onOpenChange(false)}><X className="h-3.5 w-3.5" /></IconAction></div></header><div className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing" onPointerCancel={() => { dragRef.current = null; }} onPointerDown={(event) => { dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={pointerMove} onPointerUp={(event) => { dragRef.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onWheel={wheel}><div className="absolute inset-8 grid place-items-center transition-transform duration-100" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}><MermaidCanvas svg={svg} /></div></div></DialogContent></Dialog>;
}

function MermaidBlock({ closed, source }: { closed: boolean; source: string }) {
  const { locale } = usePreferences();
  const theme = useResolvedTheme();
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const { copied, copy } = useCopyFeedback(source);
  const oversized = isOversizedMermaid(source);
  useEffect(() => {
    if (!closed || oversized) return;
    let active = true;
    setSvg(null);
    setError(null);
    void renderMermaid(source, theme).then((value) => {
      if (active) setSvg(value);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { active = false; };
  }, [closed, oversized, source, theme]);
  if (!closed) return <CodeBlock code={source} language="mermaid" />;
  return <section className="my-4 overflow-hidden rounded-[7px] border border-[#deded9] bg-[#fafaf8] dark:border-border dark:bg-[#1b1d19]"><header className="flex h-8 items-center border-b border-[#e5e5e0] bg-[#f3f3f0] pl-1.5 pr-1 dark:border-border dark:bg-[#252722]"><div className="inline-flex rounded-[5px] bg-[#e8e8e4] p-0.5 dark:bg-[#30322c]"><button className={cn("h-6 rounded-[4px] px-2 text-[9px] font-semibold text-muted-foreground", mode === "preview" && "bg-white text-[#41413d] shadow-sm dark:bg-[#20221e] dark:text-foreground")} onClick={() => setMode("preview")} type="button">{locale === "zh-CN" ? "图表" : "Diagram"}</button><button className={cn("h-6 rounded-[4px] px-2 text-[9px] font-semibold text-muted-foreground", mode === "source" && "bg-white text-[#41413d] shadow-sm dark:bg-[#20221e] dark:text-foreground")} onClick={() => setMode("source")} type="button">{locale === "zh-CN" ? "源码" : "Source"}</button></div><div className="ml-auto flex items-center"><IconAction label={copied ? locale === "zh-CN" ? "已复制" : "Copied" : locale === "zh-CN" ? "复制源码" : "Copy source"} onClick={() => void copy()}>{copied ? <Check className="h-3.5 w-3.5 text-[#66833d]" /> : <Copy className="h-3.5 w-3.5" />}</IconAction><IconAction disabled={!svg} label={locale === "zh-CN" ? "全屏查看" : "Open fullscreen"} onClick={() => setFullscreen(true)}><Maximize2 className="h-3.5 w-3.5" /></IconAction></div></header>{mode === "source" ? <CodeBlock code={source} language="mermaid" /> : oversized ? <div className="flex min-h-28 items-center gap-2 px-4 py-5 text-[11px] text-[#8d5e4e] dark:text-[#e4a694]"><ImageOff className="h-4 w-4 shrink-0" />{locale === "zh-CN" ? "Mermaid 源码过长，已停止渲染。请查看源码。" : "This Mermaid source is too large to render. View the source instead."}</div> : error ? <div className="px-4 py-4 text-[11px] leading-5 text-[#8d5e4e] dark:text-[#e4a694]"><p className="font-semibold">{locale === "zh-CN" ? "图表渲染失败" : "Diagram could not be rendered"}</p><p className="mt-1 line-clamp-3 font-mono text-[9px] opacity-80">{error}</p></div> : svg ? <div className="min-h-40 overflow-auto p-5"><MermaidCanvas svg={svg} /></div> : <div className="flex min-h-40 items-center justify-center gap-2 text-[10px] text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{locale === "zh-CN" ? "正在渲染图表" : "Rendering diagram"}</div>}{svg ? <MermaidFullscreen onOpenChange={setFullscreen} open={fullscreen} source={source} svg={svg} /> : null}</section>;
}

function RemoteMarkdownImage({ alt, src }: { alt?: string; src?: string }) {
  const { locale } = usePreferences();
  const safeUrl = src ? safeRemoteImageUrl(src) : null;
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!safeUrl) return <span className="text-[12px] text-muted-foreground">{alt ?? (locale === "zh-CN" ? "图片不可用" : "Image unavailable")}</span>;
  const host = new URL(safeUrl).host;
  if (!loaded || failed) return <span className="my-3 flex min-h-16 items-center gap-3 rounded-[7px] border border-[#e1e1dc] bg-[#fafaf8] px-3 py-2.5 dark:border-border dark:bg-[#1d1f1b]"><ImageOff className="h-4 w-4 shrink-0 text-[#899184]" /><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium text-[#555550] dark:text-foreground">{alt || (locale === "zh-CN" ? "远程图片" : "Remote image")}</span><span className="block truncate font-mono text-[9px] text-muted-foreground">{host}</span></span><button className="h-7 shrink-0 rounded-[5px] border border-[#d8d8d2] px-2 text-[10px] font-medium text-[#595954] hover:bg-[#efefeb] dark:border-border dark:text-foreground dark:hover:bg-muted" onClick={() => { setFailed(false); setLoaded(true); }} type="button">{failed ? locale === "zh-CN" ? "重试" : "Retry" : locale === "zh-CN" ? "加载图片" : "Load image"}</button></span>;
  return <span className="my-3 block overflow-hidden rounded-[7px] border border-[#e1e1dc] bg-[#fafaf8] p-2 dark:border-border dark:bg-[#1d1f1b]"><img alt={alt ?? ""} className="mx-auto block max-h-[32rem] max-w-full object-contain" crossOrigin="anonymous" loading="lazy" onError={() => setFailed(true)} referrerPolicy="no-referrer" src={safeUrl} /></span>;
}

type MarkdownPreProps = ComponentPropsWithoutRef<"pre"> & ExtraProps;

export const MessageMarkdown = memo(function MessageMarkdown({ text }: { text: string }) {
  const client = useRuntimeClient();
  const deferredText = useDeferredValue(text);
  const components = useMemo<Components>(() => ({
    a: ({ children, href }) => {
      const safeUrl = typeof href === "string" ? safeExternalUrl(href) : null;
      if (!safeUrl) return <span className="text-muted-foreground">{children}</span>;
      return <a className="font-medium text-[#587846] underline decoration-[#a8bb91] underline-offset-2 hover:text-[#3f6230] dark:text-[#c3df8a] dark:decoration-[#667b46] dark:hover:text-[#d8efa8]" href={safeUrl} onClick={(event) => { event.preventDefault(); void client.openExternalUrl(safeUrl); }} rel="noreferrer">{children}</a>;
    },
    blockquote: ({ children }) => <blockquote className="my-4 border-l-2 border-[#b9c7a8] bg-[#f7f8f3] py-1 pl-3.5 pr-2 text-[#62685b] dark:border-[#647253] dark:bg-[#20231c] dark:text-[#c6cdbb]">{children}</blockquote>,
    code: ({ children, className }) => <code className={cn("rounded-[4px] bg-[#eeeeea] px-1 py-0.5 font-mono text-[12px] text-[#43433f] dark:bg-[#2c2e29] dark:text-[#d9ddd3]", className)}>{children}</code>,
    h1: ({ children }) => <h1 className="mb-2 mt-6 text-[18px] font-bold leading-7 text-[#30302d] first:mt-0 dark:text-foreground">{children}</h1>,
    h2: ({ children }) => <h2 className="mb-2 mt-6 text-[16px] font-bold leading-6 text-[#343431] first:mt-0 dark:text-foreground">{children}</h2>,
    h3: ({ children }) => <h3 className="mb-1.5 mt-5 text-[15px] font-semibold leading-6 text-[#383834] first:mt-0 dark:text-foreground">{children}</h3>,
    h4: ({ children }) => <h4 className="mb-1.5 mt-4 text-[14px] font-semibold leading-6 text-[#41413d] first:mt-0 dark:text-foreground">{children}</h4>,
    h5: ({ children }) => <h5 className="mb-1 mt-4 text-[13px] font-semibold leading-5 text-[#484843] first:mt-0 dark:text-foreground">{children}</h5>,
    h6: ({ children }) => <h6 className="mb-1 mt-4 text-[12px] font-semibold leading-5 text-[#555550] first:mt-0 dark:text-foreground">{children}</h6>,
    hr: () => <hr className="my-5 border-0 border-t border-[#dfdfda] dark:border-border" />,
    img: ({ alt, src }) => <RemoteMarkdownImage alt={alt} src={typeof src === "string" ? src : undefined} />,
    input: ({ checked }) => <input checked={checked} className="mt-1 h-3.5 w-3.5 accent-[#789347]" disabled readOnly type="checkbox" />,
    li: ({ children, className }) => <li className={cn("my-1 pl-0.5 text-[14px] leading-6 text-[#51514d] marker:text-[#8a9a7a] dark:text-muted-foreground dark:marker:text-[#84946f]", className)}>{children}</li>,
    ol: ({ children }) => <ol className="my-3 list-decimal space-y-0.5 pl-6">{children}</ol>,
    p: ({ children }) => <p className="my-3 break-words text-[14px] leading-6 text-[#51514d] first:mt-0 last:mb-0 dark:text-muted-foreground">{children}</p>,
    pre: ({ children, node }: MarkdownPreProps) => {
      const child = Children.only(children);
      const element = isValidElement<{ children?: ReactNode; className?: string }>(child) ? child : null;
      const code = childText(element?.props.children).replace(/\n$/, "");
      const language = normalizeCodeLanguage(element?.props.className);
      if (language === "mermaid") return <MermaidBlock closed={hasClosedCodeFence(deferredText, node?.position?.start.offset, node?.position?.end.offset)} source={code} />;
      return <CodeBlock code={code} language={language} />;
    },
    table: ({ children }) => <div className="message-markdown-table my-4 overflow-x-auto rounded-[6px] border border-[#e0e0db] dark:border-border"><table className="w-full min-w-max border-collapse text-left text-[12px]">{children}</table></div>,
    tbody: ({ children }) => <tbody className="divide-y divide-[#e8e8e3] dark:divide-border">{children}</tbody>,
    td: ({ children }) => <td className="max-w-[28rem] px-3 py-2 align-top leading-5 text-[#5b5b55] dark:text-muted-foreground">{children}</td>,
    th: ({ children }) => <th className="bg-[#f3f3f0] px-3 py-2 font-semibold text-[#4b4b46] dark:bg-[#272923] dark:text-foreground">{children}</th>,
    thead: ({ children }) => <thead className="border-b border-[#dbdbd6] dark:border-border">{children}</thead>,
    ul: ({ children }) => <ul className="my-3 list-disc space-y-0.5 pl-6">{children}</ul>,
  }), [client, deferredText]);
  return <div className="message-markdown min-w-0"><ReactMarkdown components={components} rehypePlugins={[[rehypeKatex, { errorColor: "#a85a4f", throwOnError: false, trust: false, strict: false }]]} remarkPlugins={[remarkGfm, remarkMath, remarkWordlessMath]} skipHtml urlTransform={markdownUrlTransform}>{deferredText}</ReactMarkdown></div>;
});
