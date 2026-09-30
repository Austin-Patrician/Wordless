import type { RasterPort, RasterRequest, RasterResult } from "./raster-port.ts";

/**
 * 光栅化池。
 *
 * 三件事都在这里,而且都是"不做就会以奇怪方式坏掉"的那种:
 *
 * 1. **有界并发** —— 每个离屏视图是一个真实渲染进程。不限并发的话,打开一份 40 帧的设计
 *    会一次性拉起 40 个渲染进程。
 * 2. **每项超时** —— 一个页面卡住不该让整批永远等下去;超时按失败上报,由帧自己的状态机
 *    进 `failed`(可见的错误态,不是空白)。
 * 3. **同批去重** —— 同一帧同一档位在一次请求里出现两次时只光栅一次。
 *
 * 光栅化**永不抛错**:失败以 `ok: false` 返回。一个帧渲染不出来不该让整批失败,也不该
 * 让调用方去接异常 —— 那正是 `RasterPort` 契约里写明"永不抛错"的原因。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface RasterPoolOptions {
  port: RasterPort;
  concurrency: number;
  timeoutMs: number;
}

export class RasterPool {
  private readonly port: RasterPort;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly controllers = new Set<AbortController>();
  private cancelled = false;

  constructor(options: RasterPoolOptions) {
    this.port = options.port;
    this.concurrency = Math.max(1, Math.floor(options.concurrency));
    this.timeoutMs = Math.max(1, Math.floor(options.timeoutMs));
  }

  /** 在途数量。用于观察池是否被占满。 */
  get inFlight(): number {
    return this.controllers.size;
  }

  /**
   * 光栅化一批。返回顺序与输入顺序无关 —— 调用方按 `key` 匹配。
   *
   * 去重发生在**批内**:同一 `key` 出现多次只做一次,结果也只回一条。跨批去重交给调用方
   * (渲染层的位图缓存才是跨批的真相)。
   */
  async run(requests: readonly RasterRequest[]): Promise<RasterResult[]> {
    const unique = dedupeByKey(requests);
    if (unique.length === 0) return [];

    // 一次 run 是一个新的工作段:上一次的取消不该影响这一次。
    this.cancelled = false;
    const results: RasterResult[] = [];
    let cursor = 0;

    const workers = Array.from({ length: Math.min(this.concurrency, unique.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const request = unique[index];
        if (request === undefined) return;
        results.push(await this.captureOne(request));
      }
    });

    await Promise.all(workers);
    return results;
  }

  /**
   * 取消在途与待办。
   *
   * **已取消的结果不应被当成帧失败上报** —— 那是调用方自己要求停的,不是渲染出了问题;
   * `cancelled` 这个码就是为此存在的。
   *
   * 注意:**目前生产代码里没有调用点**(只有测试调它)。"画布离开"目前没有从渲染层传到
   * 主进程的信号,而 `blur()` 会在切换画框时频繁发生,接到那里会把正常的在途光栅也一起
   * 取消掉。真正接上需要一条"设计画布已关闭"的 IPC —— 那要动协议与 preload,不属于这次
   * 的内存修复,记在文档的待办里。
   */
  cancelAll(): void {
    this.cancelled = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private async captureOne(request: RasterRequest): Promise<RasterResult> {
    if (this.cancelled) return { ok: false, key: request.key, code: "cancelled" };

    const controller = new AbortController();
    this.controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const result = await this.port.capture(request, controller.signal);
      // 端口在超时/取消之后才回来:结果不可信(离屏视图可能已经在渲染下一个帧了),
      // 一律按"没拿到"处理,否则会把串了的内容当成这一帧的位图贴上去。
      if (timedOut) return { ok: false, key: request.key, code: "timeout" };
      if (this.cancelled) return { ok: false, key: request.key, code: "cancelled" };
      return result;
    } catch {
      // 契约说端口永不抛错,但契约是契约 —— 抛了就当成抓图失败,不让它冒到调用方。
      return { ok: false, key: request.key, code: "capture-failed" };
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }
}

function dedupeByKey(requests: readonly RasterRequest[]): RasterRequest[] {
  const seen = new Set<string>();
  const unique: RasterRequest[] = [];
  for (const request of requests) {
    if (seen.has(request.key)) continue;
    seen.add(request.key);
    unique.push(request);
  }
  return unique;
}
