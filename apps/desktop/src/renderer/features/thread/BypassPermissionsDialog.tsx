import { Button } from "@wordless/ui-kit";
import { ShieldAlert } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { usePreferences } from "../../shared/preferences";

type BypassPermissionsDialogProps = {
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  saving: boolean;
};

export function BypassPermissionsDialog({ error, onCancel, onConfirm, open, saving }: BypassPermissionsDialogProps) {
  const { locale, t } = usePreferences();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, open, saving]);

  if (!open) return null;

  const chinese = locale === "zh-CN";
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 top-[30px] z-[90] grid place-items-center bg-[#21211f]/35 px-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) onCancel(); }}>
      <section aria-describedby="bypass-permissions-description" aria-labelledby="bypass-permissions-title" aria-modal="true" className="w-full max-w-[420px] rounded-[9px] border border-[#4c3330] bg-white p-5 text-[#242421] shadow-[0_18px_42px_rgba(0,0,0,0.24)] dark:border-[#74463f] dark:bg-card dark:text-foreground" role="alertdialog">
        <div className="flex items-start gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-[#f8e8e5] text-[#b84f45] dark:bg-[#482a26] dark:text-[#f09a90]"><ShieldAlert className="h-4.5 w-4.5" /></span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold" id="bypass-permissions-title">{chinese ? "启用绕过工具审批？" : "Enable Bypass permissions?"}</h2>
            <p className="mt-1.5 text-[12px] leading-5 text-[#55554f] dark:text-muted-foreground" id="bypass-permissions-description">{chinese ? "本次会话中的普通与高风险工具审批都将自动通过。" : "Normal and high-risk tool approvals will be accepted automatically for this session."}</p>
          </div>
        </div>
        <ul className="mt-4 space-y-1.5 border-l-2 border-[#d8776e] bg-[#fdf8f7] px-3 py-2.5 text-[11px] leading-4 text-[#6f4c47] dark:border-[#9f5a51] dark:bg-[#2e2220] dark:text-[#dfb2ac]">
          <li>{chinese ? "受保护文件、风险命令和外部连接器审批会自动通过。" : "Protected files, risky commands, and connector approvals will pass automatically."}</li>
          <li>{chinese ? "工作空间边界和路径逃逸等安全硬阻止仍然有效。" : "Hard blocks such as workspace boundaries and path escapes remain enforced."}</li>
          <li>{chinese ? "需要你回答的问题仍会暂停并发送通知。" : "Requests that need your answer will still pause and notify you."}</li>
        </ul>
        {error ? <p className="mt-3 text-[11px] text-[#b24e45] dark:text-[#f09a90]" role="alert">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button disabled={saving} onClick={onCancel} type="button" variant="outline">{t("cancel")}</Button>
          <Button className="bg-[#c95249] text-white hover:bg-[#b6453d]" disabled={saving} onClick={onConfirm} type="button">{chinese ? "启用 Bypass" : "Enable Bypass"}</Button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
