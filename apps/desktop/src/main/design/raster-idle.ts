/**
 * "空闲即释放"的计时策略。
 *
 * 为什么需要它:离屏光栅窗口是**真实渲染进程**(实测各 128MB 上下)。归还之后窗口留在
 * 空闲列表里等下一次复用,而 `dispose()` 只在应用退出时才跑 —— 于是"打开过一次设计画布"
 * 的代价是**两个渲染进程常驻到退出为止**,实测合计 +264MB。
 *
 * 为什么不是"暂停窗口":这里曾经在归还时调 `stopPainting()`,实测会让**下一次复用该窗口
 * 的截图变成空位图**(3610 → 3610 → 停止 → 0 → 3610)。窗口本身留着不销毁是那条教训的
 * 一半原因;这一次收紧的是**留多久**,不是"留不留活着的窗口",所以仍然只做销毁/重建。
 *
 * 策略本身不碰 Electron,也不自己存窗口:它只回答"现在该不该触发一次释放",以及
 * "还有没有人要它"。计时器可注入,于是这段逻辑能单测,而不是只能靠肉眼看任务管理器。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface RasterIdleTimer {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RasterIdlePolicy {
  /** 有人取用了窗口:重新计时(或因为已无空闲窗口而停表)。 */
  touched(idleCount: number): void;
  /** 归还了窗口:开始/继续计时。 */
  released(idleCount: number): void;
  /** 彻底停表。`dispose()` 用它,避免销毁之后又被触发一次。 */
  stop(): void;
  /** 计时器是否在走。给测试与诊断用。 */
  readonly armed: boolean;
}

export function createRasterIdlePolicy(options: {
  idleMs: number;
  onIdle: () => void;
  timer: RasterIdleTimer;
}): RasterIdlePolicy {
  const idleMs = Math.max(0, Math.floor(options.idleMs));
  let handle: unknown = null;

  const stop = (): void => {
    if (handle !== null) options.timer.clearTimeout(handle);
    handle = null;
  };

  const arm = (idleCount: number): void => {
    stop();
    // 没有空闲窗口就没有可释放的东西;`idleMs <= 0` 表示这条策略被关掉。
    if (idleMs <= 0 || idleCount <= 0) return;
    handle = options.timer.setTimeout(() => {
      handle = null;
      options.onIdle();
    }, idleMs);
  };

  return {
    released: arm,
    touched: arm,
    stop,
    get armed() {
      return handle !== null;
    },
  };
}
