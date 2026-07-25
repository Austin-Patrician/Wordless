import { Button } from "@wordless/ui-kit";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { usePreferences } from "../../shared/preferences";

type CreateWorkspaceDialogProps = {
  onCreate: (name: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

export function CreateWorkspaceDialog({ onCreate, onOpenChange, open }: CreateWorkspaceDialogProps) {
  const { t } = usePreferences();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) setName("");
  }, [open]);

  if (!open) return null;

  const create = async () => {
    const value = name.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      await onCreate(value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4" role="presentation">
      <section aria-label={t("newProjectSpace")} aria-modal="true" className="w-full max-w-[480px] rounded-[24px] bg-white p-6 text-[#232522] shadow-[0_24px_80px_rgba(0,0,0,0.28)] dark:bg-[#20221c] dark:text-[#eef0e8]" role="dialog">
        <header className="flex items-center justify-between gap-4"><h2 className="text-[16px] font-bold">{t("newProjectSpace")}</h2><Button aria-label={t("closeSettings")} className="text-[#555952]" onClick={() => onOpenChange(false)} size="icon" type="button" variant="ghost"><X size={17} /></Button></header>
        <p className="mt-6 text-[13px] leading-6 text-[#6d706b] dark:text-[#b5b9af]">{t("newWorkspaceHelp")}</p>
        <label className="sr-only" htmlFor="new-workspace-name">{t("newWorkspaceName")}</label>
        <input
          autoFocus
          className="mt-4 h-8 w-full rounded-[8px] border border-transparent bg-[#f5f5f4] px-3 text-[13px] outline-none transition placeholder:text-[#b3b5b0] focus:border-[#cbd6ad] focus:ring-2 focus:ring-[#d9e9b7] dark:bg-[#2b2e27] dark:placeholder:text-[#747970]"
          id="new-workspace-name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
            if (event.key === "Escape") onOpenChange(false);
          }}
          placeholder={t("newWorkspaceName")}
          value={name}
        />
        <footer className="mt-4 flex justify-end gap-2"><Button disabled={submitting} onClick={() => onOpenChange(false)} size="sm" type="button" variant="secondary">{t("cancel")}</Button><Button disabled={!name.trim() || submitting} onClick={() => void create()} size="sm" type="button">{t("confirm")}</Button></footer>
      </section>
    </div>
  );
}
