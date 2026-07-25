import { ArrowLeft, ExternalLink, FileWarning } from "lucide-react";
import { type ReactNode } from "react";
import { getFileIcon } from "../../shared/fileIcons";
import { usePreferences } from "../../shared/preferences";

type DocumentPreviewProps = {
  content: string | null;
  name: string;
  onBack: () => void;
  onOpen: () => void;
  unavailableReason?: "binary" | "missing" | "too-large";
};

function extensionFrom(name: string): string | undefined {
  const index = name.lastIndexOf(".");
  return index > 0 && index < name.length - 1 ? name.slice(index + 1) : undefined;
}

function InlineMarkdown({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code className="rounded bg-[#efefeb] px-1 py-0.5 font-mono text-[11px] text-[#454540] dark:bg-muted dark:text-foreground" key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  })}</>;
}

function MarkdownPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) code.push(lines[index++]!);
      blocks.push(<pre className="mt-3 overflow-x-auto border-y border-[#e4e4df] bg-[#fafaf9] px-3 py-2 font-mono text-[11px] leading-5 text-[#4d4d47] dark:border-border dark:bg-muted dark:text-muted-foreground" key={`code-${index}`}>{code.join("\n")}</pre>);
      continue;
    }
    if (/^#{1,3}\s+/.test(line)) {
      blocks.push(<h2 className="mt-5 text-[14px] font-semibold text-[#30302d] first:mt-0 dark:text-foreground" key={`heading-${index}`}><InlineMarkdown text={line.replace(/^#{1,3}\s+/, "")} /></h2>);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      blocks.push(<p className="mt-1 flex gap-2 text-[12px] leading-5 text-[#5a5a55] dark:text-muted-foreground" key={`list-${index}`}><span>•</span><span><InlineMarkdown text={line.replace(/^[-*]\s+/, "")} /></span></p>);
      continue;
    }
    if (line.trim()) blocks.push(<p className="mt-3 whitespace-pre-wrap text-[12px] leading-5 text-[#565650] dark:text-muted-foreground" key={`text-${index}`}><InlineMarkdown text={line} /></p>);
  }
  return <div className="px-4 py-3">{blocks}</div>;
}

function TextPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  return <ol className="m-0 list-none py-2 font-mono text-[11px] leading-5 text-[#4c4c47] dark:text-muted-foreground">{lines.map((line, index) => <li className="grid grid-cols-[3rem_minmax(0,1fr)] px-3" key={index}><span className="select-none pr-3 text-right text-[#b0b0a9]">{index + 1}</span><code className="min-w-0 whitespace-pre-wrap break-words">{line}</code></li>)}</ol>;
}

export function DocumentPreview({ content, name, onBack, onOpen, unavailableReason }: DocumentPreviewProps) {
  const { t } = usePreferences();
  const markup = getFileIcon(extensionFrom(name), name);
  const markdown = /\.(md|markdown|mdx)$/i.test(name);
  const detail = unavailableReason === "binary" ? t("filePreviewBinary") : unavailableReason === "too-large" ? t("filePreviewTooLarge") : t("filePreviewUnavailable");
  return <section className="flex min-h-0 flex-1 flex-col"><header className="flex shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 py-2 dark:border-border"><button aria-label={t("back")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={onBack} type="button"><ArrowLeft className="h-3.5 w-3.5" /></button><span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center [&_svg]:h-4 [&_svg]:w-4" dangerouslySetInnerHTML={{ __html: markup }} /><span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#3e3e39] dark:text-foreground">{name}</span><button aria-label={t("openFile")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={onOpen} type="button"><ExternalLink className="h-3.5 w-3.5" /></button></header>{content === null ? <div className="grid flex-1 place-items-center px-5 text-center"><div><FileWarning className="mx-auto h-4 w-4 text-[#93938b]" /><p className="mt-3 text-[11px] leading-5 text-muted-foreground">{detail}</p></div></div> : markdown ? <MarkdownPreview content={content} /> : <TextPreview content={content} />}</section>;
}
