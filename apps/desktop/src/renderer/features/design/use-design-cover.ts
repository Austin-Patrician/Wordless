import { useEffect, useState } from "react";
import type { DesignFrameDto } from "@wordless/protocol";
import { resetCoverCacheForTests, readCover, writeCover } from "./cover-cache.ts";
import { COVER_BOX, COVER_MAX_FRAMES, drawCover } from "./design-cover.ts";

/**
 * 把当前打开的这份设计**顺手**存成一张封面。
 *
 * ## 为什么写在这里,而不是在列表页按需光栅
 *
 * 画布上这几帧的位图**已经在内存里**(贴图那一步刚光栅过),把它们画进一张小画布几乎是白送的;
 * 而列表页按需光栅意味着"每张卡一次离屏渲染"—— 那是几十个隐藏窗口,也正是这一页最不该做的事。
 * 代价是:**没在这台机器上打开过的设计没有封面**,卡片用主色块兜底(这一条是有意的,不是缺陷)。
 *
 * ## 什么时候写
 *
 * 位图到货之后(`textures` 变了),而且这份设计还没写过。不做"内容变了就重写":封面是索引里的
 * 一格,不值得为它盯着每一次刷新。
 */
export function useDesignCover(input: {
  designPath: string;
  frames: readonly DesignFrameDto[];
  /** frameId → 位图 URL(位图到货的那一份)。 */
  textures: ReadonlyMap<string, string>;
}): void {
  const { designPath, frames, textures } = input;

  useEffect(() => {
    if (designPath === "") return;
    // 已经有封面就不管了 —— 覆盖它只会让列表上的图在用户眼皮底下变一次。
    let active = true;
    const candidates = frames
      .slice(0, COVER_MAX_FRAMES)
      .map((frame) => ({ frame, url: textures.get(frame.id) }))
      .filter((candidate): candidate is { frame: DesignFrameDto; url: string } => candidate.url !== undefined);
    if (candidates.length === 0) return;

    void (async () => {
      const existing = await readCover(designPath);
      if (!active || existing !== null) return;
      const sources: { image: CanvasImageSource; size: { height: number; width: number } }[] = [];
      for (const candidate of candidates) {
        const image = await loadImage(candidate.url).catch(() => null);
        if (image === null) continue;
        sources.push({ image, size: { height: candidate.frame.height, width: candidate.frame.width } });
      }
      const canvas = sources.length === 0 ? null : drawCover(sources, COVER_BOX);
      if (canvas === null) return;
      await writeCover(designPath, canvas.toDataURL("image/jpeg", 0.82));
    })();

    return () => {
      active = false;
    };
  }, [designPath, frames, textures]);
}

/** 位图 URL 是 `<img>` 用的那种,画进 canvas 之前要先加载成图片。 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("cover image failed"));
    image.src = url;
  });
}

/** 测试用:清掉封面缓存的内存镜像。 */
export { resetCoverCacheForTests };
