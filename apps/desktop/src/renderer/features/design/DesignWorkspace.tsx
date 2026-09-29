import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Frame as FrameIcon, LoaderCircle, TriangleAlert } from "lucide-react";
import type { DesignBuildOutcomeDto, DesignOpenedDto, DesignSummaryDto } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { DesignCanvas } from "./DesignCanvas.tsx";
import { MockupExportDialog } from "./mockup-export-dialog.tsx";
import { mergeRefreshedManifest } from "./design-view.ts";
import type { InlineComposerAttachment } from "../thread/InlineSkillComposer";
import { frameReference, themeReference, workspaceRelativePath } from "./frame-reference.ts";
import { useDesignActivity } from "./use-design-activity.ts";

/** 稳定的空数组:内联 `[]` 每次都换身份,会让活动态的订阅反复重建。 */
const NO_FRAMES: never[] = [];

/**
 * 心跳间隔。
 *
 * 它直接决定"画布看起来是不是实时的"。代价在主进程侧:两边比的都是源指纹,没变就短路,
 * 所以常态只有两次读 —— 这一侧不过是每秒钟问一句。
 */
const REFRESH_INTERVAL_MS = 1_000;

/**
 * 设计画布的容器。
 *
 * 职责:找设计包 → 打开 → 把清单交给画布 → 把画布上的几何改动提交回去。渲染与交互都在
 * `DesignCanvas` 里,这里只管数据与生命周期。
 *
 * 设计包从**当前会话所在的工作区**里找:设计稿是工作区里的一个目录(`x.wdesign/`),
 * 与其它产物一样跟着项目走,而不是存在应用数据目录里。
 */
export function DesignWorkspace({
  /** 画布上已经挂到输入框的令牌(`--color-*`),由输入框那侧持有。 */
  attachedThemeTokens = [],
  onAttachFile,
  onToggleThemeToken,
  onReskin,
  running = false,
  sessionId,
}: {
  sessionId: string;
  running?: boolean;
  /**
   * 把一帧作为引用交给对话输入框。
   *
   * 由外壳注入(它才持有那条通道),画布这一侧不该知道输入框长什么样 —— 它只知道"这一帧
   * 是哪个文件、叫什么"。
   */
  onAttachFile?: (reference: InlineComposerAttachment) => void;
  /**
   * 换完体系之后**开一轮对话**,让 agent 全量重设。
   *
   * 由外壳实现:发消息要 sessionId、要 `promptSession`、还要把消息挂进对话流的待发态 —— 那些
   * 都是对话那一侧的东西,画布这一侧只该说清"设计在哪、换了哪一套、有几帧"。
   */
  onReskin?: (input: { designDir: string; frameCount: number; styleName: string }) => void;
  /** 画布上已经挂到输入框的令牌名(`--color-*`)。面板的选中态读它。 */
  attachedThemeTokens?: readonly string[];
  /**
   * 色彩系统面板上点一个令牌:没挂就挂上,已挂就摘掉。
   *
   * 这里传出去的是**已经算好的附件**(带路径):面板只知道令牌名与值,而"它属于哪个文件"只有
   * 这一层知道(它才持有设计包路径与工作区根)。
   */
  onToggleThemeToken?: (reference: InlineComposerAttachment) => void;
}) {
  const themeTokens = attachedThemeTokens;
  const client = useRuntimeClient();
  const { snapshot } = useRuntime();
  const { t } = usePreferences();

  const session = snapshot?.sessions.find((candidate) => candidate.id === sessionId);

  /**
   * 找设计包的根 —— **必须与设计工具写进去的那个根是同一个**。
   *
   * 它就是会话记录里的 `runtimeRootPath`:`create-runtime.ts` 用它构造 `design_create`
   * 等工具(`designToolsFor(context.record.runtimeRootPath)`),所以这里是同一个值,而不是
   * 一个猜出来的等价物。
   *
   * **这里原本用的是 `workspace?.rootPath`** —— 而 UI 设计会话**不需要**关联工作区。没有
   * 工作区时它拿到 `null`,于是这个组件直接返回、**从不扫描任何目录**,画布永远停在
   * 「正在生成设计…」,而 frames 与 dist 就在会话自己的私有根里(实测:那个根是
   * `<userData>/session-workspaces/<sessionId>`)。有工作区时两者恰好指向同一个目录,所以
   * 这个缺陷只在"没建工作区"的会话上露出来。
   */
  const root = session?.runtimeRootPath ?? null;

  const [designs, setDesigns] = useState<DesignSummaryDto[] | null>(null);
  const [opened, setOpened] = useState<DesignOpenedDto | null>(null);
  /**
   * 「画布从磁盘上重读了一次」的计数。色彩系统面板按它重读 `theme.css` —— 让面板跟着**磁盘**走,
   * 而不是跟着某次操作走:应用体系、agent 改令牌、用户点刷新,都会经过下面这条 `applyRefreshed`。
   */
  const [themeRevision, setThemeRevision] = useState(0);
  const [selectedFrameIds, setSelectedFrameIds] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /**
   * 导出结果的一句话。
   *
   * 与 `error` 分开:导出成功**必须说出落点**,否则用户不知道东西去哪了;而它又不是错误,
   * 不该用红底那条横幅。几秒后自己消失 —— 它是一条回执,不是一个需要处理的状态。
   */
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  /** 合成图弹窗。与目录导出各自独立:一个是单文件分享图,一个是一批交付文件。 */
  const [mockupOpen, setMockupOpen] = useState(false);
  /**
   * 画布光栅好的位图(`frameId → URL`),给导出渲染图的左栏当缩略图。
   *
   * 由画布推上来,而不是让弹窗自己去取:位图本来就在画布手里,而再取一次 = 每帧多一次
   * 离屏渲染。代价是这里存了一份 URL —— 它在画布卸载时会被 `revoke`,而弹窗与画布同生共死
   * (画布是这个区块的常驻内容),所以不构成悬空引用。
   */
  const [frameThumbnails, setFrameThumbnails] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** 手动刷新在途 —— 期间按钮不响应,免得连点叠几次。 */
  const [refreshing, setRefreshing] = useState(false);
  /**
   * 样式没编出来时的提示(不带 `build` 的那次刷新不动它)。
   *
   * 这件事在界面上**原来完全不可见**:画布只是"看着没样式",而用户无从判断是设计还是应用的问题 ——
   * 于是唯一会给出解释的是模型,而它给的是错的(实测:"你这台机器的安装损坏或被拦截",见 §14.23)。
   * 只有真的构建过的那一次(`build !== null`)才能改变这条提示:被限流或源没变时不带构建结果,
   * 那时我们并不知道答案,就不该猜。
   */
  const [buildWarning, setBuildWarning] = useState<string | null>(null);
  /**
   * 当前源指纹(来自 `refreshDesign`)。
   *
   * 它是画布位图缓存的代号:主进程说它变了,画布就知道"磁盘变了",于是这一代位图作废。
   * 与清单分开是有意的 —— 一帧改了内容而位置没变时,清单是同一个清单,而位图必须重取。
   */
  const [sourceRevision, setSourceRevision] = useState("");

  /** 把一次刷新的构建结果翻译成提示。只有真的构建过才说话。 */
  const noteBuild = useCallback(
    (build: DesignBuildOutcomeDto | null) => {
      if (build === null) return;
      if (build.ok) {
        setBuildWarning(null);
        return;
      }
      setBuildWarning(
        (build.code === "runtime-missing" ? t("designBuildRuntimeMissing") : t("designBuildFailed")) +
          ` ${build.detail}`,
      );
    },
    [t],
  );

  const openDesign = useCallback(
    async (path: string) => {
      setError(null);
      try {
        /**
         * 走 `refreshDesign` 而不是 `openDesign`:**前者同时保证样式表是编出来的。**
         *
         * 打开一份设计时它可能从来没构建过(构建失败过、或它是这个机制之前建的包),而那时
         * 帧一条样式都不生效 —— 打开时顺手补上,比让用户先看到一版"没有任何样式的画布"要好。
         * `applied: false` 时它不返回 `opened`(那一次没做事),退回 `openDesign` 直接读。
         */
        const refreshed = await client.refreshDesign({ path });
        noteBuild(refreshed.build);
        setSourceRevision(refreshed.revision);
        const next = refreshed.opened ?? (await client.openDesign({ path }));
        if (next === null) {
          setError(t("designOpenFailed"));
          return;
        }
        setOpened(next);
        setSelectedFrameIds([]);
      } catch (reason) {
        // 边界错误照实说,不美化:读不出来就是读不出来。
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [client, t],
  );

  /**
   * 拿"最新那个"打开函数,供下面两个 effect 使用。
   *
   * **这不是微优化,是正确性。** `openDesign` 依赖 `t`,而 `t` 的身份来自偏好上下文的
   * `useMemo` —— 它的依赖里有整个运行时快照。agent 一边输出快照一边变,`t` 就一边变,
   * 把这样的回调放进 effect 依赖会让 effect **反复拆掉重建**:初始加载一遍遍清空重查,
   * 而 2.5 秒的轮询间隔永远走不到头,于是设计永远不出现 —— 恰好是在最需要它的时候。
   *
   * 赋值写在 effect 里、且排在使用它的 effect 之前,所以它先跑。
   */
  const openDesignRef = useRef(openDesign);
  useEffect(() => {
    openDesignRef.current = openDesign;
  }, [openDesign]);

  /**
   * 最新那次打开的结果,供心跳读取。
   *
   * 心跳**不能**依赖 `opened`:那会让 effect 每次清单变化都拆掉重建,而一个每秒重建的
   * 定时器等于没有定时器。这与上面 `openDesignRef` 是同一个理由。
   */
  const openedRef = useRef(opened);
  openedRef.current = opened;

  /** 接上刷新回来的清单。**布局的那一半由 `mergeRefreshedManifest` 负责**(纯函数)。 */
  const applyRefreshed = useCallback((next: DesignOpenedDto) => {
    setThemeRevision((revision) => revision + 1);
    setOpened((current) =>
      current === null ? next : { ...next, manifest: mergeRefreshedManifest(current.manifest, next.manifest) },
    );
  }, []);

  /**
   * 标题与声明尺寸落在**帧源码**里(写回 `@frame` 注释),不在清单里。
   *
   * 所以这里和拖拽不一样,但它仍然先**乐观更新**一次:否则用户按下回车之后要盯着旧标题
   * 一秒。写失败就把乐观值撤回 —— 不回撤的话,画布在说一件没发生的事,而用户下一次重开
   * 设计会发现刚才那一下白改了。
   *
   * 失败最常见的原因是帧里没有 `@frame` 声明(那时没有可写的位置,见 `withFrameMeta`)。
   */
  const commitFrameMeta = useCallback(
    (frameId: string, patch: { title?: string; width?: number; height?: number }) => {
      const current = openedRef.current;
      if (current === null) return;
      const path = current.summary.path;

      setOpened((previous) =>
        previous === null
          ? previous
          : {
              ...previous,
              manifest: {
                ...previous.manifest,
                frames: previous.manifest.frames.map((frame) =>
                  frame.id === frameId ? { ...frame, ...patch } : frame,
                ),
              },
            },
      );
      void client
        .updateDesignFrameMeta({ path, frameId, meta: patch })
        .then((written) => {
          if (written) return;
          setError(t("designFrameMetaFailed"));
          // 撤回:让清单回到磁盘上的事实。
          return client.refreshDesign({ path }).then((result) => {
            if (result.applied && result.opened !== null) applyRefreshed(result.opened);
          });
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    },
    [applyRefreshed, client, t],
  );

  /**
   * 换工作区或**换会话**时重新找一遍设计包。
   *
   * `sessionId` 必须在依赖里。两个会话在同一个工作区时 `root` 相同 —— 只依赖 `root`
   * 的版本在切换会话时不会重新加载,于是画布一直显示上一个会话的设计(或者它那份空态)。
   *
   * 同时把 `opened` 清掉:不清的话上一个会话的设计会**留在画布上**,而那时画布已经属于
   * 另一个会话了。
   */
  useEffect(() => {
    if (root === null) {
      setDesigns([]);
      setOpened(null);
      return;
    }
    let active = true;
    setError(null);
    setDesigns(null);
    setOpened(null);
    void client
      .listDesigns({ root })
      .then(async (found) => {
        if (!active) return;
        setDesigns(found);
        const first = found[0];
        if (first !== undefined) await openDesignRef.current(first.path);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      active = false;
    };
  }, [client, root, sessionId]);

  /**
   * 心跳:让画布跟上磁盘。
   *
   * 两个阶段用同一个间隔,因为它们回答的是同一个问题的前后两半:
   *
   * 1. **还没有设计** —— 找一份。设计是 agent 中途建出来的,而用户正盯着这块空面板。
   * 2. **已经有了** —— 让它跟上。agent 还在往这个目录里写帧。
   *
   * 第 2 步不是"锦上添花的刷新",它是画布能用的前提:位图是磁盘的快照,而新帧、改过的帧、
   * 以及它们新用到的工具类,在刷新之前**都不存在**于画布上。
   *
   * **只在 `running` 时开**:一轮跑完之后磁盘不会再自己变,而每秒扫一遍目录是纯浪费。
   */
  useEffect(() => {
    if (root === null || !running) return;
    let active = true;
    const timer = setInterval(() => {
      const current = openedRef.current;
      if (current === null) {
        void client
          .listDesigns({ root })
          .then(async (found) => {
            if (!active || found.length === 0) return;
            setDesigns(found);
            const first = found[0];
            if (first !== undefined) await openDesignRef.current(first.path);
          })
          .catch(() => {
            // 轮询失败不打扰用户 —— 下一轮会再来。真正的错误由初始加载那次报出来。
          });
        return;
      }

      void client
        .refreshDesign({ path: current.summary.path })
        .then((result) => {
          if (active) noteBuild(result.build);
          // `applied: false` **不是失败**:源没变,或者这一次被限流了,下一次会补上。
          // 拿 `null` 去猜"是不是读不到了"才是错的。
          if (!active || !result.applied || result.opened === null) return;
          setSourceRevision(result.revision);
          applyRefreshed(result.opened);
        })
        .catch(() => {
          // 同上:刷新失败不该在界面上冒出来,它每一秒都有一次机会。
        });
    }, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [applyRefreshed, client, root, running]);

  /**
   * 画布上的移动提交回清单。
   *
   * 只在拖拽**结束**时调用一次,批量送出 —— 逐帧提交会让中途状态被看到,也让"撤销一次
   * 拖拽"变成撤销 N 次。提交后用返回值刷新清单,好让帧的坐标与磁盘一致。
   */
  const commitMove = useCallback(
    (moves: readonly { frameId: string; x: number; y: number }[]) => {
      if (opened === null || moves.length === 0) return;
      void client
        .moveDesignFrames({ path: opened.summary.path, moves: [...moves] })
        .then((written) => {
          if (!written) return;
          setOpened((current) =>
            current === null
              ? current
              : {
                  ...current,
                  manifest: {
                    ...current.manifest,
                    frames: current.manifest.frames.map((frame) => {
                      const move = moves.find((candidate) => candidate.frameId === frame.id);
                      return move === undefined ? frame : { ...frame, x: move.x, y: move.y };
                    }),
                  },
                },
          );
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    },
    [client, opened],
  );

  /**
   * agent 正在改哪一帧。
   *
   * 数据来源是渲染层**已经在收**的运行时事件流(`tool.started` / `tool.completed`),
   * 所以这条通道不需要任何新的 IPC:主进程不必知道画布在看哪一帧。
   */
  const activity = useDesignActivity({
    client,
    sessionId,
    designPath: opened?.summary.path ?? null,
    frames: opened?.manifest.frames ?? NO_FRAMES,
  });

  /**
   * 新建一帧。
   *
   * 落点**不在这里算**:主进程的对账规则会把"磁盘上有、清单里没有"的帧放到最右帧的右边
   * (`FRAME_GAP`)。这里只说"建一个",然后把返回的**对账后的**清单接上 —— 于是不用再拉一次。
   *
   * 标题带序号前缀,序号由主进程补:画布上唯一的标签就是标题,两帧同名等于没有标签。
   */
  const createFrameAt = useCallback(
    (rect: { x: number; y: number; width: number; height: number }) => {
      const current = openedRef.current;
      if (current === null) return;
      void client
        .createDesignFrame({
          path: current.summary.path,
          title: t("designFrameUntitled"),
          // 用户画出来的落点与尺寸 —— 他在画布上做的决定,不该被自动布局覆盖。
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        })
        .then((next) => {
          if (next === null) {
            setError(t("designFrameCreateFailed"));
            return;
          }
          applyRefreshed(next);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    },
    [applyRefreshed, client, t],
  );

  /**
   * 删掉一帧。
   *
   * 只从右键菜单来 —— 它是画布上唯一会丢东西的动作。成功之后就这一帧消失;失败(文件被别处
   * 删了等)把清单拉回来对齐一次,而不是把一个已经不存在的东西留在画布上。
   */
  const deleteFrame = useCallback(
    (frameId: string) => {
      const current = openedRef.current;
      if (current === null) return;
      const path = current.summary.path;
      void client
        .deleteDesignFrame({ path, frameId })
        .then((next) => {
          if (next === null) {
            setError(t("designFrameDeleteFailed"));
            return;
          }
          applyRefreshed(next);
        })
        .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
    },
    [applyRefreshed, client, t],
  );

  /**
   * 下载素材:每帧一张原尺寸图,**加**规范(`theme.css` / `DESIGN.md`)与素材文件。
   *
   * 目录由**用户挑**(对话框在主进程),画布这一侧不碰磁盘 —— 它只说"导出什么",然后等一个
   * 落点。取消不算失败:那是用户的选择,不该报红。
   *
   * 只导图那一支(`what: "frames"`)现在没有 UI 入口:它的产物是这一支的**子集**,留着两个
   * 按钮只会让人猜"我到底该点哪个"。主进程那边仍然两种都支持。
   */
  const downloadMaterials = useCallback(() => {
    const current = openedRef.current;
    if (current === null) return;
    setExporting(true);
    void client
      .exportDesign({ path: current.summary.path, what: "assets" })
      .then((result) => {
        if (result === null) {
          setError(t("designExportFailed"));
          return;
        }
        if (!result.ok) {
          if (result.reason === "cancelled") return;
          setError(result.reason === "empty" ? t("designExportEmpty") : t("designExportFailed"));
          return;
        }
        setNotice(
          t("designExportDone")
            .replace("{count}", String(result.files.length))
            .replace("{directory}", result.directory),
        );
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setExporting(false));
    },
    [client, t],
  );

  /**
   * 把一帧交给对话。
   *
   * 换算成**工作区相对路径**在 `frame-reference.ts` 里做:agent 的文件工具以工作区根为基准,
   * 而画布手上的路径是绝对的。取不出来(设计包不在工作区内)时不出声地什么都不做 —— 那说明
   * 这个会话的工作区与设计包不在同一棵树里,而画布上没有位置解释这件事。
   */
  const attachFrame = useCallback(
    (frameId: string) => {
      const current = openedRef.current;
      if (current === null || onAttachFile === undefined) return;
      const frame = current.manifest.frames.find((candidate) => candidate.id === frameId);
      if (frame === undefined) return;
      const reference = frameReference({ designPath: current.summary.path, frame, workspaceRoot: root });
      if (reference === null) return;
      onAttachFile(reference);
    },
    [onAttachFile, root],
  );

  /**
   * 当前设计在**工作区相对**路径下的位置:色彩系统面板按它读 `theme.css`。
   *
   * 取不出来(设计包不在工作区内)就是 null,面板据此不给动作 —— 与 `frameReference` 同一条
   * 纪律:宁可没有,也不给一个 agent 打不开的路径。
   */
  const designDir = useMemo(
    () => (opened === null ? null : workspaceRelativePath(opened.summary.path, root)),
    [opened, root],
  );

  /**
   * 色彩系统面板上点一个令牌:没挂就挂上,已挂就摘掉。
   *
   * 面板不写文件,它只是把"用户指的是哪一个令牌"交给对话。换算成输入框附件的那一步在上层
   * (`onAttachFile` / `onDetachFile`),这里只负责说清是哪一个令牌。
   */
  const toggleThemeToken = useCallback(
    (token: { name: string; value: string }) => {
      const current = openedRef.current;
      if (current === null) return;
      const reference = themeReference({ designPath: current.summary.path, token, workspaceRoot: root });
      if (reference === null) return;
      // 挂还是摘由上层定:它才知道输入框里现在挂着什么(见 WorkbenchShell)。
      onToggleThemeToken?.(reference);
    },
    [onToggleThemeToken, root],
  );

  /**
   * 用户按的刷新。
   *
   * 与心跳走同一个入口,两处不同:
   *
   * - **`force`**:心跳被限流是常态(下一次补上),而用户按了就是在等 —— 撞上窗口却什么都不
   *   做,读起来是"这个按钮坏了"。
   * - **不管 `changed` 是真是假都回一句话**:否则用户判断不了"我改的东西生效了没有"。
   */
  const refresh = useCallback(() => {
    const current = openedRef.current;
    if (current === null) return;
    setRefreshing(true);
    void client
      .refreshDesign({ force: true, path: current.summary.path })
      .then((result) => {
        noteBuild(result.build);
        if (result.applied && result.opened !== null) {
          setSourceRevision(result.revision);
          applyRefreshed(result.opened);
        }
        setNotice(result.changed ? t("designRefreshed") : t("designAlreadyCurrent"));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setRefreshing(false));
  }, [applyRefreshed, client, t]);

  /**
   * 应用完一套设计体系。
   *
   * 与别的动作不同,它**必须带一句话**:风格换了之后已有帧不会自己变样,而要由 agent 按新
   * 规范重设。不说的话,用户看到的是"画布几乎没变",会以为按钮没生效。
   */
  const applyStyle = useCallback(
    (result: { framesNeedRestyle: boolean; opened: DesignOpenedDto; styleName: string }) => {
      applyRefreshed(result.opened);

      const relative = workspaceRelativePath(result.opened.summary.path, root);
      /**
       * 有画框就**自动开一轮对话** —— 用户的动作是"重设整份设计稿",而不是"换两个文件之后自己
       * 再去找 agent"。替换令牌只是这件事的前半步,后半步是 agent 逐个画框改。
       *
       * 零帧时不开:没有画框要重设,那一轮对话只是浪费一次往返。
       */
      if (result.framesNeedRestyle && relative !== null && relative !== "" && onReskin !== undefined) {
        onReskin({
          designDir: relative,
          frameCount: result.opened.manifest.frames.length,
          styleName: result.styleName,
        });
        return;
      }
      setNotice(t("designStyleApplied").replace("{name}", result.styleName));
    },
    [applyRefreshed, onReskin, root, t],
  );

  /** 回执自己消失:它是一条"做完了"的通知,不是需要处理的状态。 */
  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const design = opened?.summary ?? null;
  const frameCount = opened?.manifest.frames.length ?? 0;
  /**
   * **进入**的那一帧 —— 与"被选中的那一帧"是两件事。
   *
   * 之前这里是"选中的只有一帧就是它",于是选中即进入。那条规则在原生视图下不成立:活体
   * 永远盖在所有 DOM 之上,进了活体就点不到四角手柄,所以 1:1 下选中的帧**没法缩放**,而
   * 1:1 正是用户默认待着的缩放。
   *
   * 现在:单击选中(可布局),双击进入(可交互,页面真的能点),点空白处退出。
   * 参考实现不需要这个区分 —— 它的活体是 DOM 里的 iframe,手柄能画在它上面。
   */
  const [enteredFrameId, setEnteredFrameId] = useState<string | null>(null);

  /** 选中集不再是那一帧时退出 —— 否则"进入了 A 却选中着 B"会一直留着。 */
  useEffect(() => {
    setEnteredFrameId((current) =>
      current !== null && selectedFrameIds.length === 1 && selectedFrameIds[0] === current ? current : null,
    );
  }, [selectedFrameIds]);

  /** 换设计时退出:上一个设计的"进入"状态留在新的画布上是纯粹的假信息。 */
  const designPath = opened?.summary.path ?? null;
  useEffect(() => {
    setEnteredFrameId(null);
  }, [designPath]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#fbfbfa] dark:bg-[#181912]">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[#e4e4df] px-3 dark:border-border">
        <FrameIcon className="size-3.5 text-[#8a8f94]" />
        <span className="min-w-0 truncate text-[12px] font-medium text-[#3e3e39] dark:text-foreground">
          {design?.name ?? t("designPanelTitle")}
        </span>
        {designs !== null && designs.length > 1 ? (
          <select
            aria-label={t("designPickerLabel")}
            className="h-6 min-w-0 rounded-[5px] border border-[#e2e4e6] bg-transparent px-1 text-[11px] dark:border-[#3b3e41]"
            onChange={(event) => void openDesign(event.target.value)}
            value={design?.path ?? ""}
          >
            {designs.map((candidate) => (
              <option key={candidate.id} value={candidate.path}>
                {candidate.name}
              </option>
            ))}
          </select>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#8a8f94]">
          {frameCount > 0 ? t("designFrameCount").replace("{count}", String(frameCount)) : ""}
        </span>
      </header>

      {notice !== null ? (
        <div className="flex items-center gap-2 border-b border-[#e4e4df] bg-[#f4f7f2] px-3 py-2 text-[11px] text-[#4a5a3c] dark:border-border dark:bg-[#1f241b] dark:text-[#a8bd93]">
          <Check className="size-3.5 shrink-0" />
          {/* 落点要完整可见:用户多半是要去文件管理器里找它。 */}
          <span className="min-w-0 break-all">{notice}</span>
        </div>
      ) : null}

      {error !== null ? (
        <div className="flex items-center gap-2 border-b border-[#e4e4df] bg-[#fff6f6] px-3 py-2 text-[11px] text-[#a44] dark:border-border dark:bg-[#2a1d1d]">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      {/*
        样式没编出来:**持久**提示,不是 6 秒回执 —— 它是一个需要处理的状态,而画面本身(无样式的
        帧)看起来只是"这个设计很朴素",不给理由就会被当成设计问题。构建成功时这条自己消失。
      */}
      {buildWarning !== null ? (
        <div className="flex items-center gap-2 border-b border-[#e4e4df] bg-[#fffaf0] px-3 py-2 text-[11px] text-[#8a6a1f] dark:border-border dark:bg-[#2a2418] dark:text-[#d9bd7f]">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{buildWarning}</span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {opened !== null ? (
          <DesignCanvas
            client={client}
            designPath={opened.summary.path}
            activity={activity}
            enteredFrameId={enteredFrameId}
            manifest={opened.manifest}
            onEnterFrame={setEnteredFrameId}
            onCreateFrameAt={createFrameAt}
            onApplyStyle={applyStyle}
            attachedThemeTokens={themeTokens}
            /** 合成图弹窗要用到设计包目录(读 theme.css 取色板)。 */
            designDir={designDir}
            onAttachFrame={attachFrame}
            onToggleThemeToken={toggleThemeToken}
            sessionId={sessionId}
            themeRevision={themeRevision}
            onDeleteFrame={deleteFrame}
            onDownloadMaterials={downloadMaterials}
            onOpenMockup={() => setMockupOpen(true)}
            onRefresh={refresh}
            exporting={exporting}
            refreshing={refreshing}
            sourceRevision={sourceRevision}
            onCommitFrameGeometry={(frameId, geometry) =>
              commitMove([{ frameId, x: geometry.x, y: geometry.y }])
            }
            // 对齐/分布一次提交多帧 —— 与多选拖拽同一条纪律:一次修订。
            onCommitFrameMoves={commitMove}
            onCommitFrameMeta={commitFrameMeta}
            onSelectionChange={setSelectedFrameIds}
            /** 缩略图:导出渲染图的左栏直接用画布光栅好的位图。 */
            onTextures={setFrameThumbnails}
          />
        ) : designs !== null && designs.length === 0 ? (
          /**
           * **空态必须区分这两种情况。**
           *
           * 曾经它只说"这个工作区里还没有设计" —— 对一次 agent 正在输出的会话来说,这句话
           * 读起来像故障,而且它与画廊空态的中文一模一样,连"我到底在哪个界面"都分不出来。
           */
          running ? (
            <Centered>
              <LoaderCircle className="size-4 animate-spin text-[#b3b8bd] motion-reduce:animate-none" />
              <p className="mt-2 text-[12px] text-[#8a8f94]">{t("designGenerating")}</p>
            </Centered>
          ) : (
            <Centered>
              <p className="text-[12px] text-[#8a8f94]">{t("designEmpty")}</p>
              <p className="mt-1 max-w-[320px] text-center text-[11px] leading-5 text-[#a8adb2]">{t("designEmptyHelp")}</p>
            </Centered>
          )
        ) : (
          <Centered>
            <LoaderCircle className="size-4 animate-spin text-[#b3b8bd] motion-reduce:animate-none" />
          </Centered>
        )}
      </div>

      {mockupOpen && opened !== null && designDir !== null ? (
        <MockupExportDialog
          bridge={client}
          designDir={designDir}
          designPath={opened.summary.path}
          manifest={opened.manifest}
          onClose={() => setMockupOpen(false)}
          sessionId={sessionId}
          thumbnails={frameThumbnails}
        />
      ) : null}
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center px-6 text-center">{children}</div>;
}
