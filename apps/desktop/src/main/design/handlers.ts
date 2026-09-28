import type {
  CreateDesignResultDto,
  DesignFrameMoveDto,
  DesignOpenedDto,
  DesignRasterFrameDto,
  DesignRasterResultDto,
  DesignSummaryDto,
  DesignStyleSummaryDto,
} from "@wordless/protocol";
import type { DesignLiveBoundsDto } from "@wordless/protocol";
import type { DesignStore, DesignSummary } from "./design-store.ts";
import { designFrameUrl } from "./design-url.ts";
import { DESIGN_STYLES, designStyleSummary } from "./style-catalog.ts";
import { FALLBACK_FRAME_SIZE } from "./manifest.ts";
import type { RasterPool } from "./raster-pool.ts";
import type { BuildRecipe } from "./build-recipes.ts";
import type { BuildRunner } from "./design-builder.ts";
import type { DesignViewHost } from "./design-view-host.ts";

/**
 * 设计画布的 IPC 边界,抽成纯处理器。
 *
 * 与仓库里其它能力一致:**这里不 import Electron**,所以边界本身可以被测试 —— 上一批
 * 消息推送的教训是"载荷形状必须由 DTO 单一来源定义,而且边界要有自己的覆盖"(manager
 * 的测试绕过了 IPC,渲染层的测试又 mock 了客户端,两边都测不到边界)。
 */

export interface DesignHandlers {
  listDesigns(input: { root: string }): Promise<DesignSummaryDto[]>;
  /** 不是设计包时返回 null,而不是抛错 —— 调用方据此把它从列表里排除。 */
  openDesign(input: { path: string }): Promise<DesignOpenedDto | null>;
  /** 画布上的移动。返回是否真的写入了(无变化时为 false)。 */
  moveFrames(input: { path: string; moves: DesignFrameMoveDto[] }): Promise<boolean>;
  /** 批量光栅化。结果按 key 与请求对应,顺序不保证。 */
  rasterizeFrames(input: { path: string; frames: DesignRasterFrameDto[] }): Promise<DesignRasterResultDto[]>;
  /**
   * 活体视图切到哪一帧。`frameId: null` 表示交还给位图。
   *
   * 至多一个 —— 宿主自身的形状就表达了这一点,所以这里没有 id 参数式的多路管理。
   */
  setLiveFrame(input: { path: string; frameId: string | null; bounds: DesignLiveBoundsDto | null }): Promise<boolean>;
  /** 内置风格目录。给画廊画卡片用。 */
  listStyles(): Promise<DesignStyleSummaryDto[]>;
  /** 按选中的风格建一个设计包。 */
  createDesign(input: { root: string; name: string; styleId: string | null }): Promise<CreateDesignResultDto | null>;
}

/**
 * `builds` 由主进程给:只有它知道构建脚本在哪(`__dirname/design-build.mjs`)。
 * 不给就只建包不构建 —— 于是返回的 `build` 是 `null`,而不是一个假的成功。
 */
export function createDesignHandlers(
  store: DesignStore,
  pool: RasterPool,
  host: DesignViewHost,
  builds?: { runner: BuildRunner; recipes: readonly BuildRecipe[] },
): DesignHandlers {
  return {
    async listDesigns(input: { root: string }): Promise<DesignSummaryDto[]> {
      const designs = await store.listDesigns(input.root);
      return designs.map(toSummaryDto);
    },

    async openDesign(input: { path: string }): Promise<DesignOpenedDto | null> {
      const opened = await store.openDesign(input.path);
      if (opened === null) return null;
      return {
        summary: toSummaryDto(opened.summary),
        manifest: {
          ...opened.manifest,
          ...(opened.manifest.defaultFrameSize ? { defaultFrameSize: opened.manifest.defaultFrameSize } : {}),
        },
        repaired: opened.repaired,
        frameUrls: Object.fromEntries(
          opened.manifest.frames.map((frame) => [frame.id, designFrameUrl(opened.summary.id, frame.id)]),
        ),
      };
    },

    async moveFrames(input: { path: string; moves: DesignFrameMoveDto[] }): Promise<boolean> {
      return await store.moveFrames(input.path, input.moves);
    },

    async rasterizeFrames(input: {
      path: string;
      frames: DesignRasterFrameDto[];
    }): Promise<DesignRasterResultDto[]> {
      const opened = await store.openDesign(input.path);
      if (opened === null) return [];

      const designId = opened.summary.id;
      const byId = new Map(opened.manifest.frames.map((frame) => [frame.id, frame]));
      const requests = [];
      for (const wanted of input.frames) {
        const frame = byId.get(wanted.frameId);
        // 不存在的帧直接跳过:调用方的清单可能比磁盘新一帧(刚删掉)。
        if (frame === undefined) continue;
        requests.push({
          key: `${wanted.frameId}@${wanted.bucket}`,
          url: designFrameUrl(designId, wanted.frameId),
          width: frame.width,
          height: frame.height,
          pixelRatio: wanted.bucket,
        });
      }

      const results = await pool.run(requests);
      return results.map((result) =>
        result.ok
          ? { ok: true as const, key: result.key, bytes: result.bytes, width: result.width, height: result.height }
          : { ok: false as const, key: result.key, code: result.code },
      );
    },

    async listStyles(): Promise<DesignStyleSummaryDto[]> {
      return DESIGN_STYLES.map(designStyleSummary);
    },

    async createDesign(input: {
      root: string;
      name: string;
      styleId: string | null;
    }): Promise<CreateDesignResultDto | null> {
      // 画廊里不问题品类尺寸:它只在帧漏声明时兜底,而第一帧自带声明。给一个中性的桌面尺寸,
      // 之后改一行声明即可。
      const created = await store.createDesign({
        root: input.root,
        name: input.name,
        title: input.name,
        frameWidth: FALLBACK_FRAME_SIZE.width,
        frameHeight: FALLBACK_FRAME_SIZE.height,
        styleId: input.styleId,
        ...(builds === undefined ? {} : { builds }),
      });
      if (created === null) return null;
      return {
        path: created.path,
        frameId: created.frameId,
        // 只带 code 与 detail:stdout/stderr 可能有几十 KB,而 IPC 载荷不该拿它当传输通道。
        build:
          created.build === null
            ? null
            : created.build.ok
              ? { ok: true }
              : { ok: false, code: created.build.code, detail: created.build.detail },
      };
    },

    async setLiveFrame(input: {
      path: string;
      frameId: string | null;
      bounds: DesignLiveBoundsDto | null;
    }): Promise<boolean> {
      if (input.frameId === null) {
        host.blur();
        return true;
      }
      // URL 在主进程拼:渲染层拿到的是一份"帧 id → URL"的映射,它不该知道构造规则。
      const designId = store.registry.register(input.path);
      return await host.focus({
        id: input.frameId,
        url: designFrameUrl(designId, input.frameId),
        bounds: input.bounds,
      });
    },
  };
}

/**
 * 显式映射而不是直接透传。
 *
 * 主进程内部的 `DesignSummary` 与 DTO 眼下字段相同,但两者是**不同的契约**:内部结构
 * 可以随实现调整,而 DTO 一变就是桥版本变更。写成映射函数,漂移会在这里变成编译错误。
 */
function toSummaryDto(summary: DesignSummary): DesignSummaryDto {
  return {
    id: summary.id,
    path: summary.path,
    name: summary.name,
    mode: summary.mode,
    style: summary.style,
    frameCount: summary.frameCount,
  };
}
