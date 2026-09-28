import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Frame as FrameIcon, LoaderCircle, TriangleAlert } from "lucide-react";
import type { DesignOpenedDto, DesignSummaryDto } from "@wordless/protocol";
import { usePreferences } from "../../shared/preferences";
import { useRuntime, useRuntimeClient } from "../../shared/runtime";
import { DesignCanvas } from "./DesignCanvas.tsx";

/**
 * 设计画布的容器。
 *
 * 职责:找设计包 → 打开 → 把清单交给画布 → 把画布上的几何改动提交回去。渲染与交互都在
 * `DesignCanvas` 里,这里只管数据与生命周期。
 *
 * 设计包从**当前会话所在的工作区**里找:设计稿是工作区里的一个目录(`x.wdesign/`),
 * 与其它产物一样跟着项目走,而不是存在应用数据目录里。
 */
export function DesignWorkspace({ running = false, sessionId }: { sessionId: string; running?: boolean }) {
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
  const [selectedFrameIds, setSelectedFrameIds] = useState<readonly string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const openDesign = useCallback(
    async (path: string) => {
      setError(null);
      try {
        const next = await client.openDesign({ path });
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
   * agent 正在写的时候,设计是"随时可能出现"的 —— 而它建出来的时候画布正开着。
   *
   * **只在还没有设计时轮询,一旦有了就停。** 已经打开的设计不会被这个效果换掉:用户可能
   * 正在看别的设计,或者在画布上拖着帧,那时把画布换掉比不刷新更糟。
   */
  useEffect(() => {
    if (root === null || designs === null || designs.length > 0 || !running) return;
    let active = true;
    const timer = setInterval(() => {
      void client
        .listDesigns({ root })
        .then(async (found) => {
          if (!active || found.length === 0) return;
          setDesigns(found);
          const first = found[0];
          if (first !== undefined) await openDesignRef.current(first.path);
        })
        .catch(() => {
          // 轮询失败不打扰用户 —— 下一轮会再来。真正的错误由上面那次初始加载报出来。
        });
    },
    // 这个间隔直接决定"画布看起来是不是实时的":设计是 agent 中途建出来的,而用户就盯着
    // 这块空面板。一次扫描是列几个目录、读几个清单,代价很低;而设计一出现它立刻停。
    1_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [client, designs, root, running]);

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

  const design = opened?.summary ?? null;
  const frameCount = opened?.manifest.frames.length ?? 0;
  const focusedFrameId = useMemo(
    () => (selectedFrameIds.length === 1 ? selectedFrameIds[0] : null),
    [selectedFrameIds],
  );

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

      {error !== null ? (
        <div className="flex items-center gap-2 border-b border-[#e4e4df] bg-[#fff6f6] px-3 py-2 text-[11px] text-[#a44] dark:border-border dark:bg-[#2a1d1d]">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1">
        {opened !== null ? (
          <DesignCanvas
            client={client}
            designPath={opened.summary.path}
            focusedFrameId={focusedFrameId}
            manifest={opened.manifest}
            onCommitFrameGeometry={(frameId, geometry) =>
              commitMove([{ frameId, x: geometry.x, y: geometry.y }])
            }
            onSelectionChange={setSelectedFrameIds}
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
    </section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center px-6 text-center">{children}</div>;
}
