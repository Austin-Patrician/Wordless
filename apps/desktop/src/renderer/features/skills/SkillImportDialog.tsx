import { Dialog, DialogClose, DialogContent, DialogTitle, cn } from "@wordless/ui-kit";
import { Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { usePreferences } from "../../shared/preferences";

type SkillImportDialogProps = {
  onImport: (file?: File) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function SkillImportDialog({ onImport, onOpenChange, open }: SkillImportDialogProps) {
  const { t } = usePreferences();
  const [autoInstall, setAutoInstall] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const dragDepth = useRef(0);

  const startImport = async (file?: File) => {
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      if (await onImport(file)) onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[min(36rem,calc(100vw-2rem))] overflow-visible rounded-[14px] border-[#deded9] px-7 py-7 shadow-[0_20px_55px_rgba(20,20,17,0.18)]" showCloseButton={false}>
        <div className="flex items-center justify-between gap-4">
          <DialogTitle className="text-[18px] font-bold text-[#282824] dark:text-foreground">{t("skillImportTitle")}</DialogTitle>
          <DialogClose asChild><button aria-label={t("closeSettings")} className="grid h-7 w-7 place-items-center rounded-[5px] text-[#52524d] transition-colors hover:bg-[#f0f0ec] hover:text-[#2f2f2c] dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground" type="button"><X className="h-4 w-4" /></button></DialogClose>
        </div>
        <button
          className={cn("mt-6 flex h-[164px] w-full flex-col items-center justify-center rounded-[11px] border border-dashed border-[#8c8c85] bg-[#fdfdfc] text-[#383834] transition-colors dark:border-[#74766d] dark:bg-[#1a1b16] dark:text-foreground", dragging && "border-[#647a3d] bg-[#f3f8e6] dark:border-[#bfe650] dark:bg-[#2c3620]", importing && "cursor-wait opacity-60")}
          disabled={importing}
          onClick={() => void startImport()}
          onDragEnter={(event) => { event.preventDefault(); dragDepth.current += 1; setDragging(true); }}
          onDragLeave={(event) => { event.preventDefault(); dragDepth.current -= 1; if (dragDepth.current === 0) setDragging(false); }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            const file = event.dataTransfer.files.item(0);
            if (file) void startImport(file);
          }}
          type="button"
        >
          <Upload className="h-8 w-8 text-[#777771] dark:text-muted-foreground" strokeWidth={1.5} />
          <span className="mt-4 text-[16px] font-medium">{importing ? t("importing") : t("skillImportDrop")}</span>
        </button>
        <label className="mt-5 flex w-fit cursor-pointer items-center gap-2 text-[13px] text-[#63635e] dark:text-muted-foreground">
          <input checked={autoInstall} className="h-5 w-5 appearance-none rounded-[5px] border border-[#d4d4cf] bg-white transition-colors checked:border-[#60733d] checked:bg-[#60733d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b8cd89] dark:border-border dark:bg-card dark:checked:border-[#c4eb58] dark:checked:bg-[#c4eb58]" onChange={(event) => setAutoInstall(event.target.checked)} type="checkbox" />
          {t("skillImportAutoInstall")}
        </label>
        <section className="mt-5 border-t border-[#eeeeea] pt-4 dark:border-border">
          <h2 className="text-[15px] font-bold text-[#3a3a36] dark:text-foreground">{t("skillImportRequirements")}</h2>
          <ul className="mt-2.5 list-disc space-y-1.5 pl-5 text-[13px] leading-5 text-[#686862] dark:text-muted-foreground">
            <li>{t("skillImportPackageRequirement")}</li>
            <li>{t("skillImportFrontmatterRequirement")}</li>
          </ul>
        </section>
        {error ? <p className="mt-4 text-[12px] leading-5 text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
