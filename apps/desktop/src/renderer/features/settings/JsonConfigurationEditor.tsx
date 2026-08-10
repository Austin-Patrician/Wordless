import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json, jsonParseLinter } from "@codemirror/lang-json";
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { lintKeymap, linter } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, placeholder as editorPlaceholder, rectangularSelection } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Braces, FileJson2, Maximize2, Minimize2 } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { JsonSyntaxIssue } from "./json-configuration";

type JsonConfigurationEditorProps = {
  error: JsonSyntaxIssue | null;
  example: string;
  locale: "zh-CN" | "en-US";
  minHeight: number;
  onChange: (value: string) => void;
  value: string;
};

const parseJson = jsonParseLinter();

export function JsonConfigurationEditor({ error, example, locale, minHeight, onChange, value }: JsonConfigurationEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const [fullscreen, setFullscreen] = useState(false);
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === "dark");
  onChangeRef.current = onChange;

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setDark(root.dataset.theme === "dark");
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter({ openText: "v", closedText: ">" }),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          json(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          syntaxHighlighting(jsonHighlightStyle(dark)),
          linter((editor) => editor.state.doc.toString().trim() ? parseJson(editor) : [], { delay: 250 }),
          editorPlaceholder(example),
          EditorView.contentAttributes.of({
            "aria-label": locale === "zh-CN" ? "Provider JSON 配置编辑器" : "Provider JSON configuration editor",
            autocapitalize: "off",
            spellcheck: "false",
          }),
          keymap.of([
            { key: "Ctrl-Shift-f", mac: "Cmd-Shift-f", run: formatEditor, preventDefault: true },
            { key: "Escape", run: () => fullscreen ? (setFullscreen(false), true) : false },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            ...foldKeymap,
            ...lintKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          editorTheme(dark, fullscreen, minHeight),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [dark, example, fullscreen, locale, minHeight]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const content = viewRef.current?.contentDOM;
    if (!content) return;
    content.setAttribute("aria-invalid", error ? "true" : "false");
    if (error) content.setAttribute("aria-describedby", "provider-json-syntax-error");
    else content.removeAttribute("aria-describedby");
  }, [error]);

  const labels = useMemo(() => locale === "zh-CN" ? {
    editor: "Provider JSON 配置编辑器",
    example: "载入示例",
    format: "格式化 JSON",
    fullscreen: "全屏编辑",
    exitFullscreen: "退出全屏",
    error: error ? `JSON 格式错误：${error.message}（第 ${error.line} 行，第 ${error.column} 列）` : "",
  } : {
    editor: "Provider JSON configuration editor",
    example: "Load example",
    format: "Format JSON",
    fullscreen: "Edit fullscreen",
    exitFullscreen: "Exit fullscreen",
    error: error ? `Invalid JSON: ${error.message} (line ${error.line}, column ${error.column})` : "",
  }, [error, locale]);

  const editor = (
    <section aria-label={fullscreen ? labels.editor : undefined} aria-modal={fullscreen || undefined} className={fullscreen
      ? "flex size-full min-h-0 flex-col overflow-hidden rounded-[10px] border border-border bg-card shadow-[0_24px_80px_rgba(0,0,0,.32)]"
      : `mt-3 overflow-hidden rounded-xl border bg-[#f8f9fa] transition-colors dark:bg-[#202328] ${error ? "border-[#b42318] dark:border-[#ffb4ab]" : "border-border"}`}
      role={fullscreen ? "dialog" : undefined}
    >
      <header className="flex h-9 shrink-0 items-center border-b border-border bg-[#f2f3f1] px-2 dark:bg-[#262923]">
        <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium text-muted-foreground"><Braces className="size-3.5" />JSON</span>
        <div className="ml-auto flex items-center gap-0.5">
          {!value.trim() && example ? <EditorAction label={labels.example} onClick={() => onChange(example)}><FileJson2 className="size-3.5" /></EditorAction> : null}
          <EditorAction disabled={!value.trim() || Boolean(error)} label={labels.format} onClick={() => { const view = viewRef.current; if (view) formatEditor(view); }}><Braces className="size-3.5" /></EditorAction>
          <EditorAction label={fullscreen ? labels.exitFullscreen : labels.fullscreen} onClick={() => setFullscreen((current) => !current)}>{fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}</EditorAction>
        </div>
      </header>
      <div className="min-h-0 flex-1" ref={hostRef} />
      {error ? <p className="shrink-0 border-t border-[#b42318]/20 bg-[#fff4f2] px-3 py-2 text-[10px] leading-4 text-[#b42318] dark:border-[#ffb4ab]/20 dark:bg-[#371f1c] dark:text-[#ffb4ab]" id="provider-json-syntax-error" role="alert">{labels.error}</p> : null}
    </section>
  );

  return fullscreen ? createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px] sm:p-6">
      <div className="h-full w-full max-w-[1080px] max-h-[720px]">{editor}</div>
    </div>,
    document.body,
  ) : editor;
}

function formatEditor(view: EditorView): boolean {
  const source = view.state.doc.toString();
  if (!source.trim()) return false;
  try {
    const formatted = JSON.stringify(JSON.parse(source), null, 2);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: formatted },
      selection: { anchor: 0 },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  } catch {
    view.focus();
    return false;
  }
}

function EditorAction({ children, disabled, label, onClick }: { children: ReactNode; disabled?: boolean; label: string; onClick: () => void }) {
  return <button aria-label={label} className="grid size-7 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35" disabled={disabled} onClick={onClick} title={label} type="button">{children}</button>;
}

function editorTheme(dark: boolean, fullscreen: boolean, minHeight: number) {
  const height = fullscreen ? "100%" : `${minHeight}px`;
  return EditorView.theme({
    "&": { height, backgroundColor: "transparent", color: dark ? "#e8e9e3" : "#30312e" },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: "11px", lineHeight: "1.55", letterSpacing: "0" },
    ".cm-content": { padding: "10px 0", caretColor: dark ? "#c9e66c" : "#687b39" },
    ".cm-line": { padding: "0 12px 0 8px" },
    ".cm-gutters": { backgroundColor: dark ? "#1b1e19" : "#f1f2ef", color: dark ? "#73786e" : "#969a91", border: "none", borderRight: `1px solid ${dark ? "#373b34" : "#e2e4de"}` },
    ".cm-gutterElement": { padding: "0 3px 0 2px" },
    ".cm-activeLine": { backgroundColor: dark ? "rgba(200,239,89,.045)" : "rgba(112,132,61,.055)" },
    ".cm-activeLineGutter": { backgroundColor: dark ? "#252920" : "#e8ebe2", color: dark ? "#d4d8cd" : "#555b4d" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: dark ? "#46532c" : "#dce8bd" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: dark ? "#c9e66c" : "#687b39" },
    ".cm-foldGutter span": { fontSize: "12px" },
    ".cm-lint-marker-error": { content: "''" },
    ".cm-tooltip": { border: `1px solid ${dark ? "#44483f" : "#d9dbd5"}`, backgroundColor: dark ? "#242721" : "#ffffff", color: dark ? "#e8e9e3" : "#30312e" },
    ".cm-panels": { backgroundColor: dark ? "#242721" : "#f6f7f4", color: dark ? "#e8e9e3" : "#30312e" },
    ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${dark ? "#44483f" : "#d9dbd5"}` },
    ".cm-textfield": { border: `1px solid ${dark ? "#4a4e45" : "#d4d7cf"}`, backgroundColor: dark ? "#191b17" : "#ffffff", color: "inherit" },
  }, { dark });
}

function jsonHighlightStyle(dark: boolean) {
  return HighlightStyle.define([
    { tag: tags.propertyName, color: dark ? "#c8d99c" : "#536d2e" },
    { tag: tags.string, color: dark ? "#9dd2bd" : "#397766" },
    { tag: tags.number, color: dark ? "#aabfea" : "#45669b" },
    { tag: [tags.bool, tags.null], color: dark ? "#d1b0e4" : "#81579a" },
    { tag: tags.punctuation, color: dark ? "#a2a79c" : "#73776f" },
    { tag: tags.invalid, color: dark ? "#ffb4ab" : "#b42318", textDecoration: "underline wavy" },
  ]);
}
