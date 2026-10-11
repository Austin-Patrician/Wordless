import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from "@wordless/ui-kit";
import { Bot, FolderInput, Search } from "lucide-react";
import { usePreferences } from "../../shared/preferences";

/**
 * 「知识库是怎么工作的」。
 *
 * 停用那一页要有第三个出口:**在决定开启之前先知道它是什么**。所以它是一个弹窗,而不是一段
 * 更长的说明文字 —— 说明长了没人读,而这里要回答的只有三个问题:放什么、谁整理、什么时候用得上。
 *
 * 末尾那段"为什么"是刻意的:这一页之所以存在,是因为这个开关**要花 Token**,
 * 所以得说清代价,以及"不想花就关掉、关掉不影响你自己的操作"。
 */
export function KnowledgeHowItWorks({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = usePreferences();
  const steps = [
    { icon: FolderInput, title: t("knowledgeHiwStep1"), description: t("knowledgeHiwStep1Help") },
    { icon: Bot, title: t("knowledgeHiwStep2"), description: t("knowledgeHiwStep2Help") },
    { icon: Search, title: t("knowledgeHiwStep3"), description: t("knowledgeHiwStep3Help") },
  ];
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={open}
    >
      <DialogContent className="w-[min(520px,calc(100vw-2rem))] p-5" showCloseButton>
        <DialogTitle className="text-[15px] font-bold">{t("knowledgeHiwTitle")}</DialogTitle>
        <DialogDescription className="mt-1.5 text-[12px] leading-5 text-muted-foreground">
          {t("knowledgeHiwSubtitle")}
        </DialogDescription>
        <ul className="mt-4 space-y-3">
          {steps.map((step) => (
            <li className="flex items-start gap-3" key={step.title}>
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                <step.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-medium">{step.title}</p>
                <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4 rounded-xl bg-muted/60 p-3">
          <p className="text-[12px] font-medium">{t("knowledgeHiwCostTitle")}</p>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{t("knowledgeHiwCostHelp")}</p>
        </div>
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose} type="button" variant="outline">
            {t("knowledgeHiwClose")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
