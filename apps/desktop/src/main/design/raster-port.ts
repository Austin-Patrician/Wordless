/**
 * 光栅化端口。
 *
 * 与仓库里其它能力一致:池只依赖这个接口,**不 import Electron**,于是并发、超时、去重、
 * 取消这些真正会出错的地方可以注入假实现来测。真实现只有一处(`ElectronOffscreenRaster`)。
 *
 * 本文件不 import React、不 import Electron。
 */

export interface RasterRequest {
  /** 去重键,通常 `frameId@bucket`。同一批里同键只光栅一次。 */
  key: string;
  url: string;
  /** 帧的声明尺寸(CSS 像素)。 */
  width: number;
  height: number;
  /**
   * 期望的设备像素比。
   *
   * 真实现当前**按 1 倍光栅**(见 `ElectronOffscreenRaster` 的说明):Electron 的离屏
   * 渲染没有直接的 per-window 设备像素比,而 `setZoomFactor` 会重排布局 —— 设计稿在
   * 固定尺寸下不能重排。这个字段保留在契约里,好让真实现换成 CDP 设备度量时不用改调用方。
   */
  pixelRatio: number;
}

export type RasterErrorCode =
  /** 超过 `timeoutMs`。 */
  | "timeout"
  /** 页面加载失败,或渲染进程在截图前就没了。 */
  | "load-failed"
  /** 加载成功但拿不到位图。 */
  | "capture-failed"
  /**
   * 调用方自己要求停的(画布离开、设计被关掉)。
   *
   * 与其它三种**性质不同**:那三种是渲染出了问题,这一种不是。调用方据此决定是否
   * 上报成帧的失败态 —— 自己按的停不该显示成错误。
   */
  | "cancelled";

/**
 * 光栅化一项的结果。
 *
 * **两个变体都带顶层 `key`**,成功变体也不再把它埋在 `bitmap` 里。这不是风格问题:
 * 调用方拿到的是一批结果,要按 key 与请求对上。若只有失败变体有 key,调用方就得先分支
 * 才能分组 —— 而"先分支再分组"正是漏掉某一类的写法。
 *
 * 这个缺陷是测试抓出来的:成功项的 key 不在顶层,`results.find(r => r.key === ...)` 对
 * 成功项永远返回 undefined。
 */
export type RasterResult =
  | { ok: true; key: string; bytes: Uint8Array<ArrayBuffer>; width: number; height: number }
  | { ok: false; key: string; code: RasterErrorCode };

/**
 * 在离屏视图里跑一段表达式。
 *
 * 与 `RasterPort` 分开而不是并成"离屏视图的两种用法",是因为消费者不同:光栅池只用
 * `capture`,布局探针只用 `evaluate`。分开之后两者的假实现都只需要实现自己那一个方法。
 *
 * 真实现是同一个类(它已经有那套窗口生命周期),但契约是两份。
 */
export interface OffscreenEvaluatePort {
  /**
   * 加载 URL、等它落定、执行表达式、返回它的值。
   *
   * **永不抛错**:失败以 `ok: false` 返回 —— 与 `capture` 同一条纪律,一个帧探不动
   * 不该让整批检查失败。
   */
  evaluate(request: OffscreenEvaluateRequest, signal: AbortSignal): Promise<OffscreenEvaluateResult>;
}

export interface OffscreenEvaluateRequest {
  url: string;
  width: number;
  height: number;
  /** 一个自包含表达式;最后一行是返回值。见 `LAYOUT_PROBE_EXPRESSION`。 */
  expression: string;
}

export type OffscreenEvaluateResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "timeout" | "load-failed" | "evaluate-failed" };

export interface RasterPort {
  /**
   * 光栅化一帧。
   *
   * **永不抛错**:失败以 `ok: false` 返回。池建立在这一点上 —— 一个帧渲染不出来不该让
   * 整批失败,也不该让调用方去接异常。
   */
  capture(request: RasterRequest, signal: AbortSignal): Promise<RasterResult>;
}
