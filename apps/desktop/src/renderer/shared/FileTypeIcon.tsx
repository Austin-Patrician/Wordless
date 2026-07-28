import { getFileIcon, getFolderIcon } from "./fileIcons";

type FileTypeIconProps = {
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
