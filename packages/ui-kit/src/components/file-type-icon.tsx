/**
 * 文件 / 文件夹的类型图标 —— **两端共用**(`@wordless/ui-kit`)。
 *
 * 与 `ProviderIcon` 同一个位置、同一个理由:它是一张纯数据表 + 一个渲染壳,没有耦合,
 * 所以没有理由各端留一份(各留一份的下场是"新加一种文件类型要改两处")。
 *
 * 图标是**内联 SVG 字符串**,用 `dangerouslySetInnerHTML` 挂上去 —— 内容是这张表里的常量,
 * 不来自任何用户输入(路径/文件名只用来**查表**,不会进 DOM)。
 */
import { getFileIcon, getFolderIcon } from "../lib/file-icons";

export type FileTypeIconProps = {
  className?: string;
  kind: "file" | "directory";
  name: string;
  open?: boolean;
};

function extensionFromFileName(fileName: string): string | undefined {
  const index = fileName.lastIndexOf(".");
  return index > 0 && index < fileName.length - 1 ? fileName.slice(index + 1) : undefined;
}

export function FileTypeIcon({ className = "h-4 w-4 [&_svg]:h-4 [&_svg]:w-4", kind, name, open = false }: FileTypeIconProps) {
  const markup = kind === "directory" ? getFolderIcon(name, open) : getFileIcon(extensionFromFileName(name), name);
  return <span aria-hidden className={`grid shrink-0 place-items-center ${className}`} dangerouslySetInnerHTML={{ __html: markup }} />;
}
