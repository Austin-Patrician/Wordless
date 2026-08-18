import { ArrowLeft, ExternalLink, FileWarning } from "lucide-react";
import { FileTypeIcon } from "../../shared/FileTypeIcon";
import { usePreferences } from "../../shared/preferences";
import { MessageMarkdown } from "../thread/MessageMarkdown";
import "./document-preview.css";

type DocumentPreviewProps = {
  content: string | null;
  name: string;
  onBack: () => void;
  onOpen: () => void;
  unavailableReason?: "binary" | "missing" | "too-large";
};

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="artifact-markdown-preview px-4 py-3.5">
      <MessageMarkdown text={content} />
    </div>
  );
}

function TextPreview({ content }: { content: string }) {
  const lines = content.split("\n");
  return <ol className="m-0 list-none py-2 font-mono text-[11px] leading-5 text-[#4c4c47] dark:text-muted-foreground">{lines.map((line, index) => <li className="grid grid-cols-[3rem_minmax(0,1fr)] px-3" key={index}><span className="select-none pr-3 text-right text-[#b0b0a9]">{index + 1}</span><code className="min-w-0 whitespace-pre-wrap break-words">{line}</code></li>)}</ol>;
}

export function DocumentPreview({ content, name, onBack, onOpen, unavailableReason }: DocumentPreviewProps) {
  const { t } = usePreferences();
  const markdown = /\.(md|markdown|mdx)$/i.test(name);
  const detail = unavailableReason === "binary" ? t("filePreviewBinary") : unavailableReason === "too-large" ? t("filePreviewTooLarge") : t("filePreviewUnavailable");
  return <section className="flex min-h-0 flex-1 flex-col"><header className="flex shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 py-2 dark:border-border"><button aria-label={t("back")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={onBack} type="button"><ArrowLeft className="h-3.5 w-3.5" /></button><FileTypeIcon kind="file" name={name} /><span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#3e3e39] dark:text-foreground">{name}</span><button aria-label={t("openFile")} className="grid h-6 w-6 place-items-center rounded-[5px] text-[#74746d] hover:bg-[#f0f0ec] dark:hover:bg-muted" onClick={onOpen} type="button"><ExternalLink className="h-3.5 w-3.5" /></button></header><div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">{content === null ? <div className="grid min-h-full place-items-center px-5 text-center"><div><FileWarning className="mx-auto h-4 w-4 text-[#93938b]" /><p className="mt-3 text-[11px] leading-5 text-muted-foreground">{detail}</p></div></div> : markdown ? <MarkdownPreview content={content} /> : <TextPreview content={content} />}</div></section>;
}
