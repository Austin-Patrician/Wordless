import { Button } from "@wordless/ui-kit";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { usePreferences } from "../../shared/preferences";

type DeleteCustomProviderDialogProps = {
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  providerName: string;
  saving: boolean;
};

export function DeleteCustomProviderDialog({ onCancel, onConfirm, open, providerName, saving }: DeleteCustomProviderDialogProps) {
  const { t } = usePreferences();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open, saving]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-[30px] z-[80] grid place-items-center bg-[#21211f]/35 px-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onCancel(); }}>
      <section aria-describedby="delete-provider-description" aria-labelledby="delete-provider-title" aria-modal="true" className="w-full max-w-[380px] rounded-[9px] border border-[#3b3b38] bg-white p-5 text-[#242421] shadow-[0_18px_42px_rgba(0,0,0,0.24)] dark:border-border dark:bg-card dark:text-foreground" role="alertdialog">
        <h2 className="text-[15px] font-bold" id="delete-provider-title">{t("deleteCustomProvider")}</h2>
        <p className="mt-3 text-[12px] leading-5 text-[#454540] dark:text-muted-foreground" id="delete-provider-description">{t("deleteCustomProviderHelp").replace("{provider}", providerName)}</p>
        <div className="mt-5 flex justify-end gap-2"><Button disabled={saving} onClick={onCancel} type="button" variant="outline">{t("cancel")}</Button><Button className="bg-[#e25358] text-white hover:bg-[#cf4147]" disabled={saving} onClick={onConfirm} type="button">{t("delete")}</Button></div>
      </section>
    </div>,
    document.body,
  );
}
