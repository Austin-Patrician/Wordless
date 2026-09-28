import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeEventEnvelope } from "@wordless/protocol";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import type { DesignFrameDto } from "@wordless/protocol";
import {
  activityKindForTool,
  activitySettlement,
  activityTargets,
  toolPathOf,
  UPDATED_ACTIVITY_MS,
  type ActiveFrameActivity,
  type FrameActivity,
} from "./frame-activity.ts";

/**
 * 把会话的工具调用投影成逐帧的活动态。
 *
 * 数据来源是**渲染层已经在收的**运行时事件流(`tool.started` / `tool.completed`),所以这条
 * 通道不需要新的 IPC —— 主进程不必知道画布在看哪一帧。这也是它与参考实现唯一的结构差别:
 * 它的画布和 agent 在同一个进程里,所以那边直接用模块级状态;这里两者之间隔着一个事件流,
 * 而那个事件流本来就在。
 *
 * 三处刻意的地方:
 *
 * 1. **生成阶段就点亮,不等执行。** `write` 一次就是几十秒,而时间几乎全花在**生成参数**上,
 *    执行只要几毫秒。等执行事件才亮,看起来就是"改完之后闪一下"。
 * 2. **最短停留 2.5s。** 工具调用常常不到一秒就返回,而活动态是给人看的 —— 一闪而过等于没有。
 * 3. **在途调用按 callId 记账。** `tool.completed` 只带 callId,不带路径;目标帧要靠它找回。
 *    而且一次调用可能点亮多帧(改的是 `theme.css` 这种共享件)。
 */
export function useDesignActivity(input: {
  client: DesktopBridge | null;
  sessionId: string | null;
  designPath: string | null;
  frames: readonly DesignFrameDto[];
}): ReadonlyMap<string, FrameActivity> {
  const { client, designPath, sessionId } = input;

  const [activity, setActivity] = useState<ReadonlyMap<string, FrameActivity>>(() => new Map());

  /**
   * 帧列表与设计目录名走 ref:事件回调只注册一次,不该因为一帧新增就重订阅 ——
   * 重订阅的那一瞬间正好是 agent 最可能发事件的时刻。
   */
  const framesRef = useRef(input.frames);
  framesRef.current = input.frames;
  const designName = useMemo(() => {
    if (designPath === null) return null;
    const normalized = designPath.replaceAll("\\", "/").replace(/\/+$/, "");
    const name = normalized.split("/").pop();
    return name === undefined || name === "" ? null : name;
  }, [designPath]);
  const designNameRef = useRef(designName);
  designNameRef.current = designName;

  useEffect(() => {
    if (client === null || sessionId === null) return;

    /** callId → 这次调用点亮了谁、是什么态、什么时候开始。 */
    const activeCalls = new Map<string, { frameIds: readonly string[]; kind: ActiveFrameActivity; startedAt: number }>();
    const timers = new Map<string, number>();

    const clearTimer = (frameId: string): void => {
      const timer = timers.get(frameId);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timers.delete(frameId);
      }
    };

    const unsubscribe = client.subscribe((envelope: RuntimeEventEnvelope) => {
      if (envelope.sessionId !== sessionId) return;
      const name = designNameRef.current;
      if (name === null) return;
      const event = envelope.event;

      if (event.type === "tool.started") {
        const kind = activityKindForTool(event.name);
        if (kind === null) return;
        const path = toolPathOf(event.input);
        if (path === null) return;
        const frameIds = activityTargets({ path, designName: name, frames: framesRef.current });
        if (frameIds.length === 0) return;

        activeCalls.set(event.callId, { frameIds, kind, startedAt: Date.now() });
        setActivity((current) => {
          const next = new Map(current);
          for (const frameId of frameIds) {
            clearTimer(frameId);
            next.set(frameId, kind);
          }
          return next;
        });
        return;
      }

      if (event.type === "tool.completed") {
        const call = activeCalls.get(event.callId);
        if (call === undefined) return;
        activeCalls.delete(event.callId);

        const { result, delayMs } = activitySettlement({
          kind: call.kind,
          isError: event.isError,
          startedAt: call.startedAt,
          now: Date.now(),
        });

        for (const frameId of call.frameIds) {
          const finish = (): void => {
            timers.delete(frameId);
            setActivity((current) => {
              // 这一帧已经被别的调用接管了,收场不归这次管。
              if (current.get(frameId) !== call.kind) return current;
              const next = new Map(current);
              if (result === "updated") {
                next.set(frameId, "updated");
                timers.set(
                  frameId,
                  window.setTimeout(() => {
                    timers.delete(frameId);
                    setActivity((inner) => {
                      if (inner.get(frameId) !== "updated") return inner;
                      const cleared = new Map(inner);
                      cleared.delete(frameId);
                      return cleared;
                    });
                  }, UPDATED_ACTIVITY_MS),
                );
              } else {
                next.delete(frameId);
              }
              return next;
            });
          };

          if (delayMs === 0) {
            finish();
            continue;
          }
          clearTimer(frameId);
          timers.set(frameId, window.setTimeout(finish, delayMs));
        }
        return;
      }

      // 一轮结束:把在途的全部清掉。这是收场事件丢了时的兜底 —— 否则活动态会永远挂在那里,
      // 而"永远挂着的状态"比没有状态更糟。
      if (event.type === "session.idle" || event.type === "run.completed" || event.type === "run.failed" || event.type === "run.cancelled") {
        activeCalls.clear();
        for (const timer of timers.values()) window.clearTimeout(timer);
        timers.clear();
        setActivity((current) => (current.size === 0 ? current : new Map()));
      }
    });

    return () => {
      unsubscribe();
      activeCalls.clear();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [client, sessionId]);

  // 换设计 / 换会话时清空:上一个设计的活动态留在新的画布上是纯粹的假信息。
  useEffect(() => {
    setActivity((current) => (current.size === 0 ? current : new Map()));
  }, [designPath]);

  return activity;
}
