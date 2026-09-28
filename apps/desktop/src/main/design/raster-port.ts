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
   * 期望的设备像素比 —— **真的会生效**,位图按 `width × pixelRatio` 出。
   *
   * 曾经它是"接收但不用"的:离屏渲染的 `paint` 位图被钉在 1 倍,而 `setZoomFactor` 会
   * 重排布局(设计稿在固定尺寸下不能重排)。实测之后改走 CDP 的
   * `Page.captureScreenshot` + `clip.scale`,倍率是**确定性**的 —— 见
   * `ElectronOffscreenRaster` 的说明。
   *
   * 值就是缩放档位(`frameId@bucket` 里的那个 bucket),所以画布在 2 倍档位下贴的是 2 倍图。
   */
  pixelRatio: number;
  /**
   * 编码格式。默认 JPEG。
   *
   * 画布贴的位图要的是**小**:同样像素数下 JPEG 比 PNG 小一个量级,而它只是一层底图。
   * 导出的渲染图要的是**准**:PNG 无损,而用户拿去用的时候不会希望文字边缘有 JPEG 的振铃。
   * 同一个离屏窗口两种都出,差别只在最后那一次编码。
   */
  format?: "jpeg" | "png";
}

/**
 * 一次截图交给 CDP 的参数。
 *
 * 抽出来是因为它是这一层里**唯一可断言、又真的会被用错**的判断:画布要小(JPEG),导出要准
 * (PNG);而倍率走 `clip.scale`,**不是窗口尺寸** —— 改窗口尺寸会让页面按新视口**重排**,
 * 导出的图比页面大一圈、周边留白(`handlers.ts` 里踩过这个坑)。
 *
 * 真实现 import 了 Electron,`node --test` 加载不了 —— 不抽出来的话,"导出给的是 PNG"
 * 与"倍率走 clip 而不是窗口"这两件事就没有测试守着。
 */
export function rasterCaptureParams(request: {
  width: number;
  height: number;
  pixelRatio: number;
  format?: "jpeg" | "png";
}): {
  format: "jpeg" | "png";
  quality: number | undefined;
  clip: { x: number; y: number; width: number; height: number; scale: number };
} {
  const format = request.format === "png" ? "png" : "jpeg";
  return {
    format,
    // PNG 没有质量参数;传了也只是被忽略,不如不传。
    quality: format === "jpeg" ? JPEG_QUALITY : undefined,
    clip: {
      x: 0,
      y: 0,
      width: Math.max(1, Math.round(request.width)),
      height: Math.max(1, Math.round(request.height)),
      // 倍率必须有限且为正:0 会出一张空图,NaN 出一张尺寸不可知的图。
      scale: Number.isFinite(request.pixelRatio) && request.pixelRatio > 0 ? request.pixelRatio : 1,
    },
  };
}

/** 画布贴的位图默认质量。UI 截图里有大片纯色与文字,质量低了文字边缘会糊。 */
const JPEG_QUALITY = 90;

/**
 * 从编码后的字节里读出真实像素尺寸。
 *
 * **不靠 `width × scale` 算**,而是读回来:那是权威值,而算出来的值一旦与编码器差一个像素,
 * 画布上就会半像素错位(位图被贴进一个尺寸不符的槽)。
 *
 * 认不出格式就返回 null —— 调用方据此报失败,而不是拿一个猜的尺寸继续。
 */
export function imagePixelSize(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG:8 字节签名,IHDR 的宽高在 16..24。
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  // JPEG:扫段找 SOF(0xC0..0xCF,排除 0xC4/0xC8/0xCC)。
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1] ?? 0;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return {
          width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
          height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        };
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        offset += 2;
        continue;
      }
      const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }

  return null;
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
