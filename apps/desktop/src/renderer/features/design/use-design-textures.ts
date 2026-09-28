import { useEffect, useMemo, useRef, useState } from "react";
import type { DesktopBridge } from "../../../bridge/desktop-bridge";
import type { DesignFrameDto } from "@wordless/protocol";
import { zoomBucket } from "./camera.ts";
import { DESIGN_CANVAS_BUDGETS } from "./budgets.ts";
import { TextureCache } from "./texture-cache.ts";

/**
 * 为画布准备位图。
 *
 * 流程:按当前缩放档算出需要的 key → 只请求缓存里没有的 → 结果是 JPEG 字节,转成
 * 位图 URL 放进缓存 → 返回 `frameId → url` 给节点贴。
 *
 * 三处刻意的选择:
 *
 * 1. **按缩放档请求,不是按缩放值**。档位来自 `zoomBuckets`,取"不超过当前 zoom 的最大
 *    档" —— 于是从 100% 微调到 98% 不会触发重新光栅。位图只会被放大显示,放大是模糊的、
 *    可接受的;取高于当前的档则会被缩小显示,既丢细节又浪费内存。
 * 2. **只请求缓存里没有的**。缓存跨批次保留,所以平移、缩放档不变时**一个请求都不发**。
 * 3. **用位图 URL 而不是 ImageBitmap**。`ImageBitmap` 要画到 canvas 上才能显示,而这里是
 *    `<img>`;URL 由缓存负责 `revoke`。换成 `ImageBitmap` 是后续的优化(省一次解码),
 *    但那要引入 canvas 绘制层。
 *
 * 4. **源变了就重新光栅。** 位图是**磁盘的**快照,而 agent 一直在改磁盘。没有这一步,
 *    画布会停在打开那一刻:新帧不出现、旧帧改了也不变。`sourceRevision` 就是"磁盘变了"的
 *    那个信号(来自 `refreshDesign` 的源指纹),它一变,这一代位图全部作废。
 *
 * 取消:设计被关掉或组件卸载时,把在途请求的结果丢掉(主进程侧的取消由池负责)。
 */

export interface DesignTextures {
  /** frameId → 位图 URL。没有的帧按占位呈现。 */
  textures: ReadonlyMap<string, string>;
  /** 缓存变化计数。节点列表据此在**一批位图到货后同步一次**,而不是每张一次。 */
  revision: number;
}

/**
 * 位图缓存键 = 帧 + 缩放档。
 *
 * **刻意不带源指纹**:同一帧同一档只该有一个条目。带上代次会让"改一次源"多留一份位图,
 * 而那份永远用不到 —— 旧位图的价值是**在新位图到货之前顶一下**,不是留作历史。
 */
export function textureKeyOf(frameId: string, bucket: number): string {
  return `${frameId}@${bucket}`;
}

export function useDesignTextures(input: {
  client: DesktopBridge | null;
  designPath: string | null;
  frames: readonly DesignFrameDto[];
  zoom: number;
  /** 源指纹(来自 `refreshDesign`)。变了 = 磁盘变了 = 这一代位图全部作废。 */
  sourceRevision: string;
}): DesignTextures {
  const { client, designPath, frames, sourceRevision, zoom } = input;
  const cacheRef = useRef<TextureCache<string> | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = new TextureCache<string>({ dispose: (url) => URL.revokeObjectURL(url) });
  }
  const cache = cacheRef.current;

  const [revision, setRevision] = useState(0);
  const bucket = useMemo(() => zoomBucket(zoom, DESIGN_CANVAS_BUDGETS.zoomBuckets), [zoom]);
  const generationRef = useRef(0);
  /**
   * 每一个缓存键是**从哪一代源**光栅出来的。
   *
   * 存在的理由是它不能是别的:光看 `cache.has()` 答不出"这张图还新不新",而那正是整个
   * 缺陷的形状 —— 位图在缓存里,于是它看起来总是"已经有了"。
   *
   * 失败的光栅不记进来,于是它会随下一次清单变化重试;而成功的那一代换掉旧句柄,所以
   * 这里的条目数永远是"帧 × 档位",不是它的几倍。
   */
  const rasterizedRef = useRef(new Map<string, string>());

  useEffect(() => {
    return () => {
      // 卸载时释放全部 URL:否则每个设计打开一次就漏一批。
      cache.clear();
    };
  }, [cache]);

  useEffect(() => {
    if (client === null || designPath === null || frames.length === 0) return;

    const missing = frames
      .map((frame) => ({ frame, key: textureKeyOf(frame.id, bucket) }))
      .filter((candidate) => rasterizedRef.current.get(candidate.key) !== sourceRevision);
    if (missing.length === 0) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    let active = true;

    void client
      .rasterizeDesignFrames({
        path: designPath,
        frames: missing.map((candidate) => ({ frameId: candidate.frame.id, bucket })),
      })
      .then((results) => {
        // 这一轮已经被更新的一轮取代(换了档位或换了设计):结果丢掉,别贴错图。
        if (!active || generationRef.current !== generation) return;
        let stored = 0;
        for (const result of results) {
          // 失败的帧**不记代次**:它会在下一次清单变化时重试,而不是永远停在旧图上。
          if (!result.ok) continue;
          const url = URL.createObjectURL(new Blob([result.bytes], { type: "image/jpeg" }));
          cache.set(result.key, url, result.bytes.byteLength);
          rasterizedRef.current.set(result.key, sourceRevision);
          stored += 1;
        }
        // 一批只同步一次节点 —— 逐张同步会让 40 帧的设计产生 40 次整图重排。
        if (stored > 0) setRevision((current) => current + 1);
      })
      .catch(() => {
        // 光栅化整批失败不是致命错误:帧继续以占位态显示,而占位态是可见的。
      });

    return () => {
      active = false;
    };
    // `sourceRevision` 必须在依赖里:它就是"agent 又改了磁盘"这件事本身。
  }, [bucket, cache, client, designPath, frames, sourceRevision]);

  const textures = useMemo(() => {
    const map = new Map<string, string>();
    for (const frame of frames) {
      const url = cache.get(textureKeyOf(frame.id, bucket));
      if (url !== null) map.set(frame.id, url);
    }
    return map;
    // revision 进依赖:位图到货后要重新读一遍缓存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, cache, frames, revision]);

  return { textures, revision };
}


