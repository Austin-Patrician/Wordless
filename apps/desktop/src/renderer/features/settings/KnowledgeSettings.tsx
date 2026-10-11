import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, FolderOpen, LoaderCircle, Trash2 } from "lucide-react";
import {
  KNOWLEDGE_AUTO_PROCESS_OPTIONS,
  KNOWLEDGE_ROUND_BUDGET_OPTIONS,
  knowledgeSettingsFor,
  withKnowledgeLibrarySettings,
  type ModelReference,
} from "@wordless/domain";
import type { KnowledgeClearPlan, KnowledgeLibraries } from "@wordless/protocol";
import { KnowledgeConfirmDialog } from "../knowledge/KnowledgeDialogs";
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch } from "@wordless/ui-kit";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";

/**
 * 知识库设置。
 *
 * 一项全局(开关),三项**属于当前这个库**(模型 / 间隔 / 每轮预算)—— 每项都对应一个
 * **真实生效**的行为,这是这一页唯一的原则:一个什么都不做的控件比没有更糟。
 *
 * 「现在改的是哪个库」必须摆在明面上:设置按库名记,而库名可以在 Finder 里改。用户看着甲库
 * 的设置、心里想的是乙库,是这一页唯一会真出错的用法。
 */

/**
 * 一行一项:**名称与解释在左,控件在右**。
 *
 * 五项各占一张卡又高又散,而其中三项本来讲的是同一件事(这个库怎么整理)。一行一项省空间,
 * 而且"这行是干什么的"不用往下扫。
 *
 * 版式与「环境」页的动作行**逐字一致**(标题 13px 半粗、解释 12px/20px 在左,控件在右,
 * 窄屏上下堆叠):两页并排切换时,行高、字重、间距都不该有差别。
 */
function SettingRow({
  id,
  title,
  help,
  control,
}: {
  id?: string;
  title: string;
  help: string;
  control: ReactNode;
}) {
  const text = (
    <>
      <span className="block text-[13px] font-semibold">{title}</span>
      <span className="mt-1 block max-w-[56ch] text-[12px] leading-5 text-[#73736d] dark:text-muted-foreground">{help}</span>
    </>
  );
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      {id === undefined ? (
        <div className="min-w-0">{text}</div>
      ) : (
        <label className="min-w-0" htmlFor={id}>
          {text}
        </label>
      )}
      <div className="shrink-0">{control}</div>
    </div>
  );
}

/** Radix 的 Select 不接受空值,所以"跟随会话模型"需要一个哨兵。 */
const FOLLOW_SESSION_MODEL = "__follow__";

function modelOptionValue(model: { connectionId: string; modelId: string }): string {
  return `${model.connectionId}/${model.modelId}`;
}

export function KnowledgeSettings() {
  const { knowledge, setKnowledge, t } = usePreferences();
  const { snapshot } = useRuntime();
  const client = useRuntimeClient();
  const [libraries, setLibraries] = useState<KnowledgeLibraries | undefined>(undefined);
  /** 清空整理结果的确认:先拿到"会失去什么",再让用户决定。 */
  const [clearPlan, setClearPlan] = useState<KnowledgeClearPlan | undefined>(undefined);
  const [clearing, setClearing] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | undefined>(undefined);

  useEffect(() => {
    void client
      .getKnowledgeLibraries()
      .then(setLibraries)
      .catch(() => setLibraries(undefined));
  }, [client]);

  /**
   * 写目标的那个库名。
   *
   * **必须是宿主解析出来的那个**,不能是偏好里那个:偏好里可能是 `null`(用户从没切过库),
   * 拿它当写目标就是往空名字上写 —— 归一直接丢掉,于是三个控件怎么切都不生效,切完还弹回默认值。
   * 解析器那边 `null` 会退到第一个可用的库,而 `getKnowledgeLibraries()` 给的正是它。
   */
  const current = libraries?.active ?? knowledge.activeKnowledgeBase ?? "";

  // 下面三项都从这个对象读、也只用 `withKnowledgeLibrarySettings` 写 ——
  // 三处各写一遍"展开 + 只改一格",迟早会有一处把别的库覆盖掉。
  const settings = knowledgeSettingsFor(knowledge, current);

  const enabledModels = snapshot?.modelConfiguration.models.filter((model) => model.kind === "chat" && model.enabled) ?? [];
  // 每一项因为**自己的**理由而不可用:库名还不知道 → 三项都无处可写;没有可用模型 → 只有
  // "用哪个模型"无从选起(间隔与预算跟有没有模型无关,不该跟着一起变灰)。
  const libraryUnknown = current === "";
  const selectedModelValue =
    settings.processingModel === null
      ? FOLLOW_SESSION_MODEL
      : modelOptionValue({ connectionId: settings.processingModel.connectionId, modelId: settings.processingModel.modelId });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
      {/* 正文宽度、卡片间距、卡片底色都与「环境」「通用」一致:680px 居中、2.5 的间距、
          22px 圆角浅底卡片(无描边)。标题与说明已经在弹窗头部,这里不再重复一遍。 */}
      <div className="mx-auto max-w-[680px] space-y-2.5">
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <SettingRow
            control={
              <Switch
                checked={knowledge.enabled}
                id="knowledge-enabled"
                onCheckedChange={(enabled) => void setKnowledge({ ...knowledge, enabled })}
              />
            }
            help={t("knowledgeEnabledHelp")}
            id="knowledge-enabled"
            title={t("knowledgeEnabled")}
          />
        </section>

        {/*
          「现在改的是哪个库」—— 下面三项按库名记,而库名可以在 Finder 里改,所以这一行不能省。
          库多于一个时顺便给个切换器:否则要改乙库得先去知识库页切、再回来设。
        */}
        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <SettingRow
            control={
              libraries !== undefined && libraries.names.length > 1 ? (
                <Select
                  onValueChange={(name) => {
                    // 同步本地状态:下面三项按 `libraries.active` 读,不同步的话切完还是旧库的
                    // 设置(切换器自己也会显示旧值)。
                    setLibraries({ ...libraries, active: name });
                    void setKnowledge({ ...knowledge, activeKnowledgeBase: name });
                  }}
                  value={libraries.active}
                >
                  <SelectTrigger className="min-w-[170px] shrink-0 rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="knowledge-library">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {libraries.names.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="text-[13px]">{libraries?.active ?? t("knowledgeCurrentLibraryUnknown")}</span>
              )
            }
            help={t("knowledgeCurrentLibraryHelp")}
            {...(libraries !== undefined && libraries.names.length > 1 ? { id: "knowledge-library" } : {})}
            title={t("knowledgeCurrentLibrary")}
          />
        </section>

        {/*
          **这三项同属当前库,所以在一组里,一行一项**:名称与解释在左、控件在右。
          五个独立卡片又高又散,而它们本来讲的是同一件事(这个库怎么整理)。组内用分隔线而不是
          间距 —— 分隔线说"这几行是一组",间距只会说"这几行各是各的"(与「通用」里那组通知开关同款)。
        */}
        <section className="rounded-2xl bg-[#f7f7f5] px-4 dark:bg-[#22241c]">
          <div className="divide-y divide-[#e1e1db] dark:divide-border">
            <div className="py-3">
              <SettingRow
                control={
                  <Select
                    disabled={libraryUnknown || enabledModels.length === 0}
                    onValueChange={(value) => {
                      const model: ModelReference | null =
                        value === FOLLOW_SESSION_MODEL
                          ? null
                          : (() => {
                              const [connectionId, ...rest] = value.split("/");
                              return { connectionId: connectionId ?? "", modelId: rest.join("/") };
                            })();
                      void setKnowledge(withKnowledgeLibrarySettings(knowledge, current, { processingModel: model }));
                    }}
                    value={selectedModelValue}
                  >
                    <SelectTrigger className="min-w-[170px] shrink-0 rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="knowledge-model">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={FOLLOW_SESSION_MODEL}>{t("knowledgeFollowSessionModel")}</SelectItem>
                      {enabledModels.map((model) => (
                        <SelectItem key={modelOptionValue({ connectionId: model.providerId, modelId: model.modelId })} value={modelOptionValue({ connectionId: model.providerId, modelId: model.modelId })}>
                          {model.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
                help={enabledModels.length === 0 ? t("knowledgeNeedsModel") : t("knowledgeProcessingModelHelp")}
                id="knowledge-model"
                title={t("knowledgeProcessingModel")}
              />
            </div>

            <div className="py-3">
              <SettingRow
                control={
                  <Select
                    disabled={libraryUnknown}
                    onValueChange={(value) => void setKnowledge(withKnowledgeLibrarySettings(knowledge, current, { autoProcessMinutes: Number(value) }))}
                    value={String(settings.autoProcessMinutes)}
                  >
                    <SelectTrigger className="min-w-[170px] shrink-0 rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="knowledge-interval">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KNOWLEDGE_AUTO_PROCESS_OPTIONS.map((minutes) => (
                        <SelectItem key={minutes} value={String(minutes)}>
                          {minutes === 0 ? t("knowledgeIntervalManual") : t("knowledgeIntervalEvery").replace("{minutes}", String(minutes))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
                help={t("knowledgeIntervalHelp")}
                id="knowledge-interval"
                title={t("knowledgeInterval")}
              />

              {/*
                定时加工**要求显式选过模型**(绝不回退默认模型)。所以这里必须把"现在到底会不会自动跑"
                说清楚 —— 否则用户设了 5 分钟、却因为没选模型而什么都没发生,只能靠猜。
                它属于「自动整理」这一行,所以留在这个分隔段里,不另起一行。
              */}
              {settings.autoProcessMinutes > 0 && settings.processingModel === null && (
                <p className="mt-2 flex items-start gap-1.5 text-[12px] text-amber-600 dark:text-amber-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {t("knowledgeIntervalNeedsModel")}
                </p>
              )}
            </div>

            <div className="py-3">
              <SettingRow
                control={
                  <Select
                    disabled={libraryUnknown}
                    onValueChange={(value) => void setKnowledge(withKnowledgeLibrarySettings(knowledge, current, { maxFilesPerRound: Number(value) }))}
                    value={String(settings.maxFilesPerRound)}
                  >
                    <SelectTrigger className="min-w-[170px] shrink-0 rounded-lg border-border bg-white px-3 py-2 text-left text-[12px] dark:bg-[#181912]" id="knowledge-budget">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KNOWLEDGE_ROUND_BUDGET_OPTIONS.map((files) => (
                        <SelectItem key={files} value={String(files)}>
                          {files === 0 ? t("knowledgeBudgetUnlimited") : t("knowledgeBudgetFiles").replace("{files}", String(files))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                }
                help={t("knowledgeBudgetHelp")}
                id="knowledge-budget"
                title={t("knowledgeBudget")}
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-[#f7f7f5] p-4 dark:bg-[#22241c]">
          <SettingRow
            control={
              <Button onClick={() => void client.revealKnowledgeRoot()} size="sm" type="button" variant="outline">
                <FolderOpen className="h-3.5 w-3.5" />
                {t("knowledgeReveal")}
              </Button>
            }
            help={t("knowledgeLocationHelp")}
            title={t("knowledgeLocation")}
          />

          {/*
            **清空整理结果 ≠ 删库。**
            删库会把 `raws/` 里用户的原件一起删掉(那是库标题下的「删除这个库」);
            这里只清派生物,原件还在,下一轮重新加工 —— 所以它是"整理得不对,我想让它重来"
            的出口,而不是"我不要这个库了"。

            先看再清(与导入那份同一套):第一趟不带 confirm,只问"会失去什么",
            尤其是"没有原文可重新加工"的那些页 —— 它们清掉就真的没了。
          */}
          <div className="mt-4 border-t border-border/60 pt-4">
            <SettingRow
              control={
                <Button
                  className="text-destructive hover:text-destructive"
                  disabled={clearing}
                  onClick={() => {
                    void client
                      .clearKnowledgePages()
                      .then(setClearPlan)
                      .catch(() => setClearPlan(undefined));
                  }}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {clearing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  {t("knowledgeClearPages")}
                </Button>
              }
              help={t("knowledgeClearPagesHelp")}
              title={t("knowledgeClearPages")}
            />
          </div>
        </section>

        {clearPlan !== undefined && (
          <KnowledgeConfirmDialog
            confirmLabel={t("knowledgeClearPages")}
            description={[
              t("knowledgeClearPagesConfirm").replace("{pages}", String(clearPlan.pages)),
              clearPlan.withoutRaw > 0
                ? t("knowledgeClearPagesWithoutRaw").replace("{count}", String(clearPlan.withoutRaw))
                : undefined,
              clearPlan.verified > 0
                ? t("knowledgeClearPagesVerified").replace("{count}", String(clearPlan.verified))
                : undefined,
            ]
              .filter((line): line is string => line !== undefined)
              .join("\n")}
            onCancel={() => setClearPlan(undefined)}
            onConfirm={() => {
              setClearPlan(undefined);
              setClearing(true);
              void client
                .clearKnowledgePages({ confirm: true })
                .then(() => setClearNotice(t("knowledgeClearPagesDone")))
                .catch((error: unknown) => setClearNotice(error instanceof Error ? error.message : String(error)))
                .finally(() => setClearing(false));
            }}
            open
            title={t("knowledgeClearPages")}
            tone="danger"
          />
        )}

        {clearNotice !== undefined && (
          <p className="text-[12px] text-muted-foreground" role="status">
            {clearNotice}
          </p>
        )}
      </div>
    </div>
  );
}
