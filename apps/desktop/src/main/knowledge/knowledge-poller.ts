/**
 * 两种轮次:
 *   - `process`:把投递箱里的原始文件加工成页面(增量,见 `knowledge-diff.ts`);
 *   - `lint`:给已有的库做体检(Karpathy 的第三个操作,见 `knowledge-lint.ts`)。
 *
 * 它们共用同一套调度、并发与状态,差别只在"准备什么"和"收什么尾" —— 所以那两件事由宿主注入
 * (`prepare` / `finish`),而这一层只负责**什么时候跑、能不能跑、跑完了怎么收场**。
 */
export type KnowledgeRoundKind = "process" | "lint";

/**
 * 一轮准备好的活:prompt + 一句话摘要(日志与界面用)。
 *
 * `TContext` 是**宿主自己的东西**(比如这一轮的待办计划)。调度层不解释它,收尾时原样还回去 ——
 * 这样"算待办"和"对账产出"能共用同一份数据,而这一层不必知道知识库的领域类型。
 */
export interface KnowledgeRoundPreparation<TContext = unknown> {
  kind: KnowledgeRoundKind;
  prompt: string;
  /** 形如 `+3 ~1`(加工)或 `死链 2、孤立页 1`(体检)。 */
  summary: string;
  /**
   * 这一轮**要不要起会话**。
   *
   * 有些轮次只有工程侧的动作(移动/删除/回收)而没有 agent 的活:那时不起会话,但**收尾照走**
   * —— 重建目录、追加时间线、对账失败记录都还得做。把这个判断放在这里(而不是让宿主
   * 自己在 `prepare` 里顺手收尾),是为了让收尾只有**一个**调用点:以前两条路各收各的,
   * 于是"有活的那一轮"漏掉了失败对账,而日志还在报成功。
   */
  needsAgent: boolean;
  context?: TContext;
}

/**
 * 知识库的加工调度器。
 *
 * 一次加工 = **一个 `knowledge` 工作类型的会话**,所以这一层不碰模型、不碰工具 —— 它只决定
 * "什么时候起一轮""这一轮有没有活""跑完了要收什么尾"。模型与工具是会话的事(§6.2)。
 *
 * ## 三个刻意的取舍
 *
 * 1. **手动与定时走同一条路。** 「立即整理」与定时轮询都调 {@link KnowledgePoller.organize},
 *    区别只有一个入参(reason)。两条路各写一遍"算待办 → 起会话 → 收尾",迟早会漂。
 * 2. **同一时刻只跑一轮。** 加工会写页面,两轮并发会互相覆盖;而且没人希望两个会话同时改一个库。
 * 3. **定时加工要求显式选过模型,绝不回退默认模型。** 无人值守时用哪个模型花钱,是用户必须
 *    自己做的决定 —— 静默用上主对话模型,账单是惊喜。
 *
 * ## 定时用链式 setTimeout,不用 setInterval
 *
 * `setInterval` 在上一次回调还没结束时也会照常触发。这里的回调可能跑几分钟(等一个会话),
 * 所以必须**跑完再排下一次**。
 */

/** 定时加工的间隔(分钟)。`0` = 只手动。 */
export const KNOWLEDGE_INTERVAL_OPTIONS = [0, 3, 5, 10, 30] as const;

export interface KnowledgePollerConfig {
  /** 总开关:关掉后 agent 看不到知识库工具,也不自动加工。 */
  enabled: boolean;
  /** 定时间隔(分钟);0 = 只手动。 */
  intervalMinutes: number;
  /** 加工模型。定时加工要求它非空(见文件头第 3 条)。 */
  modelKey: string | null;
}

export type KnowledgeSkipReason = "disabled" | "no-model" | "manual-only" | "busy";

/**
 * 这一轮该不该跑。**纯判定**,所以它的四种"不跑"可以逐个测。
 *
 * 手动与定时的区别只有一处:手动忽略 `manual-only`(用户就在旁边,点了他就想跑),
 * 也忽略 `no-model`(手动时模型可以跟随会话默认 —— 他看得见自己在做什么)。
 */
export function roundSkipReason(
  config: KnowledgePollerConfig,
  state: { processing: boolean },
  reason: "manual" | "scheduled",
): KnowledgeSkipReason | null {
  if (!config.enabled) return "disabled";
  if (state.processing) return "busy";
  if (reason === "manual") return null;
  if (config.intervalMinutes <= 0) return "manual-only";
  if (config.modelKey === null || config.modelKey.indexOf("/") <= 0) return "no-model";
  return null;
}

/** 会话结束的信号。只有这三种算"这一轮跑完了"。 */
const ROUND_END_EVENTS = new Set(["run.completed", "run.failed", "run.cancelled"]);

export interface KnowledgePollerOptions<TContext = unknown> {
  /** 读当前配置。**每次现读** —— 设置随时可能被改,缓存快照就会用旧的跑一轮。 */
  readConfig: () => Promise<KnowledgePollerConfig>;
  /**
   * 准备一轮:算待办/体检、做工程侧的动作、拼好 prompt。**没有活就返回 null** ——
   * "这一轮有没有活"是宿主的判断(只有它手上有 hash 与全库正文),不是这一层的。
   */
  prepare: (kind: KnowledgeRoundKind, now: string) => Promise<KnowledgeRoundPreparation<TContext> | null>;
  /** 起一个加工会话,返回它的 id。 */
  startSession: (prompt: string, modelKey: string | null) => Promise<string>;
  /** 一轮跑完后刷新派生产物(`index.md` / `log.md`)并对账失败记录。 */
  finish: (preparation: KnowledgeRoundPreparation<TContext>, now: string) => Promise<void>;
  /** "正在加工"的状态变化 —— 界面据此显示徽标。 */
  onProcessingChanged: (processing: boolean) => void;
  logger: { info: (message: string) => void; warn: (message: string) => void };
  now?: () => string;
}

export interface KnowledgeRoundOutcome<TContext = unknown> {
  /** 起了会话就有它。 */
  sessionId?: string;
  skipped?: KnowledgeSkipReason | "nothing-to-do";
  /** 这一轮准备了什么(工程侧动作也要能说清楚)。 */
  preparation?: KnowledgeRoundPreparation<TContext>;
}

export class KnowledgePoller<TContext = unknown> {
  private readonly options: KnowledgePollerOptions<TContext>;
  private readonly now: () => string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private processing = false;
  private disposed = false;
  /** 正在跑的那一轮的会话 id → 准备好的活。会话结束时用它收尾。 */
  private active: { sessionId: string; preparation: KnowledgeRoundPreparation<TContext> } | undefined;

  constructor(options: KnowledgePollerOptions<TContext>) {
    this.options = options;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  isProcessing(): boolean {
    return this.processing;
  }

  /** 读配置并(重新)调度。启动时与设置变化时调用。 */
  async reload(): Promise<void> {
    if (this.disposed) return;
    this.clearTimer();
    const config = await this.options.readConfig();
    if (roundSkipReason(config, { processing: this.processing }, "scheduled") !== null) {
      this.options.logger.info("knowledge auto-processing is off");
      return;
    }
    this.schedule(config.intervalMinutes);
  }

  stop(): void {
    this.disposed = true;
    this.clearTimer();
  }

  /**
   * 跑一轮。手动与定时共用这一条。
   *
   * 顺序:判定能不能跑 → 算待办(工程侧动作在这里做完)→ 没活就不起会话 → 起会话。
   * **收尾不在这里**:会话是异步跑完的,收尾由 {@link handleRuntimeEvent} 触发。
   */
  async organize(reason: "manual" | "scheduled", kind: KnowledgeRoundKind = "process"): Promise<KnowledgeRoundOutcome<TContext>> {
    if (this.disposed) return { skipped: "disabled" };
    const config = await this.options.readConfig();
    const skipped = roundSkipReason(config, { processing: this.processing }, reason);
    if (skipped !== null) return { skipped };

    const now = this.now();
    const preparation = await this.options.prepare(kind, now);
    if (preparation === null) {
      // 真的什么都没发生(加工:diff 是空的;体检:库是干净的)→ 不起会话、也不收尾。
      this.options.logger.info(`knowledge ${kind} round: nothing to do`);
      return { skipped: "nothing-to-do" };
    }

    if (!preparation.needsAgent) {
      // 只有工程侧的动作(移动/删除/回收),没有 agent 的活:不起会话,但**收尾照走** ——
      // 白起一个会话只会得到一句"没什么可做的",而它照样占一个会话位。
      await this.options.finish(preparation, now);
      this.options.logger.info(`knowledge ${kind} round: engineering only, no session`);
      return { skipped: "nothing-to-do", preparation };
    }

    this.setProcessing(true);
    try {
      const sessionId = await this.options.startSession(preparation.prompt, config.modelKey);
      this.active = { sessionId, preparation };
      this.options.logger.info(`knowledge ${kind} round started: ${preparation.summary} session=${sessionId}`);
      return { sessionId, preparation };
    } catch (error) {
      // 起会话失败:把状态放回去,否则界面会一直显示"正在整理"。
      this.setProcessing(false);
      this.options.logger.warn(`knowledge round could not start: ${error instanceof Error ? error.message : String(error)}`);
      return { skipped: "busy" };
    }
  }

  /**
   * 会话事件:这一轮跑完了就收尾。
   *
   * `sessionId` 允许为 null(runtime 的全局事件)—— 它当然不等于任何一轮的会话 id。
   */
  handleRuntimeEvent(envelope: { sessionId?: string | null; event: { type: string } }): void {
    const active = this.active;
    if (!active || envelope.sessionId !== active.sessionId) return;
    if (!ROUND_END_EVENTS.has(envelope.event.type)) return;
    this.active = undefined;
    const now = this.now();
    void (async () => {
      try {
        // 收尾:对账失败记录 + 重建目录/追加时间线。**中止的轮次也算跑完**,但中止不该被
        // 记成"这个文件写不出来" —— 那是用户自己停的。
        await this.options.finish(active.preparation, now);
      } catch (error) {
        this.options.logger.warn(`knowledge round finalize failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.setProcessing(false);
        // 跑完再排下一次(链式,不用 setInterval)。
        await this.reload().catch(() => undefined);
      }
    })();
  }

  private setProcessing(next: boolean): void {
    if (this.processing === next) return;
    this.processing = next;
    this.options.onProcessingChanged(next);
  }

  private schedule(minutes: number): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void (async () => {
        try {
          await this.organize("scheduled");
        } catch (error) {
          this.options.logger.warn(`knowledge scheduled round failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        // 没起会话(没活/被跳过)时也要排下一次 —— 否则一轮空转之后轮询就停了。
        if (this.active === undefined) await this.reload().catch(() => undefined);
      })();
    }, minutes * 60_000);
    // 定时器不该拖住进程退出。
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
