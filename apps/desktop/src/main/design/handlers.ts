import type {
  CreateDesignResultDto,
  DesignSaveImageResultDto,
  DesignBuildOutcomeDto,
  DesignFrameMetaDto,
  DesignFrameMoveDto,
  DesignOpenedDto,
  DesignRasterFrameDto,
  DesignRasterResultDto,
  DesignRefreshResultDto,
  DesignSummaryDto,
  DesignStyleDetailDto,
  DesignStyleSummaryDto,
} from "@wordless/protocol";
import type {
  ApplyDesignStyleResultDto,
  DesignExportResultDto,
  DesignLiveBoundsDto,
} from "@wordless/protocol";
import type { DesignExporter } from "./design-exporter.ts";
import { joinPath } from "./scaffold.ts";
import type { DesignStore, DesignSummary, OpenedDesign } from "./design-store.ts";
import { designFrameUrl } from "./design-url.ts";
import { DESIGN_STYLES, designStyleById, designStyleSummary } from "./style-catalog.ts";
import { FALLBACK_FRAME_SIZE } from "./manifest.ts";
import type { RasterPool } from "./raster-pool.ts";
import type { BuildRecipe } from "./build-recipes.ts";
import type { DesignClipboard } from "./design-clipboard.ts";
import type { BuildRunner, DesignBuildResult } from "./design-builder.ts";
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
  /**
   * 让一份设计回到当前磁盘状态:新帧上画布、帧内容刷新、样式表重编。
   *
   * 画布每秒问一次,而常态只有两次读 —— 主进程用源指纹短路。`applied` 为假**不是失败**:
   * 源没变、或者这一次被限流了,下一次轮询会补上。
   */
  refreshDesign(input: { path: string; force?: boolean }): Promise<DesignRefreshResultDto>;
  /** 画布上的移动。返回是否真的写入了(无变化时为 false)。 */
  moveFrames(input: { path: string; moves: DesignFrameMoveDto[] }): Promise<boolean>;
  /**
   * 新建一个空白帧,并返回**对账之后**的清单 —— 于是渲染层不用再拉一次。
   *
   * 不是设计包时返回 null,与 `openDesign` 一致。
   */
  createFrame(input: {
    path: string;
    title?: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  }): Promise<DesignOpenedDto | null>;
  /** 删掉一帧,返回**对账之后**的清单。 */
  deleteFrame(input: { path: string; frameId: string }): Promise<DesignOpenedDto | null>;
  /** 把一套内置风格应用到已有设计上。风格 id 不存在时返回 null。 */
  applyStyle(input: { path: string; styleId: string }): Promise<ApplyDesignStyleResultDto | null>;
  /**
   * 导出渲染图或资源到用户挑的目录。
   *
   * 没配 `exporter` 时返回 `null` —— 与 `builds` 同一条纪律:**没有的能力照实说没有**,
   * 而不是给一个假的成功。
   */
  exportDesign(input: { path: string; what: "frames" | "assets" }): Promise<DesignExportResultDto | null>;
  /**
   * 改一帧的标题或声明尺寸 —— 写回帧源码里的 `@frame` 注释。
   *
   * 与 `moveFrames` 分开而不是合并成一次"更新帧":它们落在不同的地方(位置进清单,
   * 声明进源码),而接口分得开,调用方就不可能把两件事当成一件。
   */
  updateFrameMeta(input: { path: string; frameId: string; meta: DesignFrameMetaDto }): Promise<boolean>;
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
  /** 一套风格的正文(示例页 + 规范)。按 id 现取 —— 列里不带这两份大文本。 */
  styleDetail(input: { id: string }): Promise<DesignStyleDetailDto | null>;
  /** 按选中的风格建一个设计包。 */
  createDesign(input: { root: string; name: string; styleId: string | null }): Promise<CreateDesignResultDto | null>;
  /**
   * 存一张合成图。
   *
   * **字节从渲染层来**(合成发生在 canvas 上),所以这一侧只负责"问到落点、写下去"。
   * 取消不是错误 —— 界面不该为此报红。
   */
  saveMockupImage(input: {
    fileName: string;
    extension: "png" | "pdf";
    bytes: Uint8Array<ArrayBuffer>;
  }): Promise<DesignSaveImageResultDto>;
  /** 把一张合成图放进剪贴板。剪贴板被占用时返回 false。 */
  copyMockupImage(input: { bytes: Uint8Array<ArrayBuffer> }): Promise<boolean>;
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
  /** 导出那套宿主能力(目录/文件对话框 + 写文件)。不注入就没有导出。 */
  exporter?: DesignExporter,
  /** 剪贴板。不注入就没有"复制"。 */
  clipboard?: DesignClipboard,
): DesignHandlers {
  return {
    async listDesigns(input: { root: string }): Promise<DesignSummaryDto[]> {
      const designs = await store.listDesigns(input.root);
      return designs.map(toSummaryDto);
    },

    async openDesign(input: { path: string }): Promise<DesignOpenedDto | null> {
      const opened = await store.openDesign(input.path);
      return opened === null ? null : toOpenedDto(opened);
    },

    /**
     * 与 `openDesign` 的差别只有一个:**它会补齐缺失的样式表。**
     *
     * `built` 模式下 `dist/theme.css` 只能由一次构建产出,而 agent 每加一个工具类都需要
     * 重编一次 —— 少了这一步,帧会**一条样式都不生效**(见 `design-store.refreshDesign`)。
     */
    async refreshDesign(input: { path: string; force?: boolean }): Promise<DesignRefreshResultDto> {
      const result = await store.refreshDesign({
        designPath: input.path,
        ...(builds === undefined ? {} : { builds }),
        ...(input.force === undefined ? {} : { force: input.force }),
      });
      return {
        revision: result.revision,
        changed: result.changed,
        applied: result.applied,
        opened: result.opened === null ? null : toOpenedDto(result.opened),
        build: toBuildOutcomeDto(result.build),
      };
    },

    async moveFrames(input: { path: string; moves: DesignFrameMoveDto[] }): Promise<boolean> {
      return await store.moveFrames(input.path, input.moves);
    },

    async createFrame(input: {
      path: string;
      title?: string;
      width?: number;
      height?: number;
      x?: number;
      y?: number;
    }): Promise<DesignOpenedDto | null> {
      const opened = await store.createFrame({
        designPath: input.path,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        ...(input.x === undefined ? {} : { x: input.x }),
        ...(input.y === undefined ? {} : { y: input.y }),
      });
      return opened === null ? null : toOpenedDto(opened);
    },

    async deleteFrame(input: { path: string; frameId: string }): Promise<DesignOpenedDto | null> {
      const opened = await store.deleteFrame(input.path, input.frameId);
      return opened === null ? null : toOpenedDto(opened);
    },

    async applyStyle(input: { path: string; styleId: string }): Promise<ApplyDesignStyleResultDto | null> {
      const applied = await store.applyStyle(input.path, input.styleId);
      if (applied === null) return null;
      return { framesNeedRestyle: applied.framesNeedRestyle, opened: toOpenedDto(applied.opened) };
    },

    async exportDesign(input: { path: string; what: "frames" | "assets" }): Promise<DesignExportResultDto | null> {
      if (exporter === undefined) return null;
      const opened = await store.openDesign(input.path);
      if (opened === null) return { ok: false, reason: "failed", detail: "not a design package" };

      const directory = await exporter.chooseDirectory();
      // 取消不是错误:界面不该为此报红。
      if (directory === null) return { ok: false, reason: "cancelled" };

      const files: string[] = [];

      /**
       * 交付物 = 各帧的渲染图 + 规范(theme.css / DESIGN.md)+ 素材(assets/**)。
       *
       * **两件事都要渲染图**,这正是与"素材"这个说法有关的修正:参考实现里「下载素材」指的
       * 是**每帧一张原尺寸完整图**,交给设计师二次加工 —— 不是设计包里的 `assets/` 目录。
       * 我一开始按后者实现,于是"这份设计没有 assets 目录"就报「没有可导出的东西」,而它
       * 其实有五个帧。
       *
       * 两者仍然分开:`frames` 只给图(拿去贴、给人看),`assets` 给图**加**规范与素材文件
       * (整套交接)。
       */
      const frames = opened.manifest.frames;
      const designId = opened.summary.id;
      const results =
        frames.length === 0
          ? []
          : await pool.run(
              frames.map((frame) => ({
                key: frame.id,
                url: designFrameUrl(designId, frame.id),
                /**
                 * **窗口就是帧的声明尺寸,不乘倍数。**
                 *
                 * 这里踩过:原来传的是 `frame.width * scale`,于是离屏窗口变成 780 宽,而页面
                 * 按 780 的视口**重排**、内容只占左边 390 —— 导出的图比页面大一圈、右边和下边
                 * 一片空白。倍数只能来自**设备像素比**,而它改的才是每 CSS 像素几个物理像素。
                 * (`pixelRatio` 在真实现里目前不生效,见 `electron-offscreen-raster.ts` 的说明:
                 * 正确的路径是 CDP 设备度量,未经验证所以没写。所以今天的导出是 1 倍。)
                 */
                width: frame.width,
                height: frame.height,
                pixelRatio: 1,
                // 导出要的是**准**:PNG 无损,用户拿去用的时候不该看到 JPEG 的振铃。
                format: "png" as const,
              })),
            );

      const failed: string[] = [];
      for (const result of results) {
        if (!result.ok) {
          failed.push(result.key);
          continue;
        }
        const target = joinPath(directory, `${result.key}.png`);
        await exporter.writeFile(target, result.bytes);
        files.push(target);
      }
      // 部分失败把成功的交出去,同时把失败的说清楚;一张都没出来才是失败。
      if (results.length > 0 && files.length === 0) {
        return { ok: false, reason: "failed", detail: failed.join(", ") };
      }

      if (input.what === "assets") {
        for (const extra of await store.listDeliverableFiles(input.path)) {
          const target = joinPath(directory, extra.relPath);
          await exporter.copyFile(extra.path, target);
          files.push(target);
        }
      }

      // 帧和可交付文件都没有,才是真的没东西可导。
      return files.length === 0 ? { ok: false, reason: "empty" } : { ok: true, directory, files };
    },


    async updateFrameMeta(input: {
      path: string;
      frameId: string;
      meta: DesignFrameMetaDto;
    }): Promise<boolean> {
      return await store.updateFrameMeta(input.path, input.frameId, input.meta);
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

    async styleDetail(input: { id: string }): Promise<DesignStyleDetailDto | null> {
      const style = designStyleById(input.id);
      // 认不出来的 id 返回 null,而不是抛:风格目录会随版本变化,而一条过期的引用不该把
      // 详情页变成一次报错。
      return style === undefined
        ? null
        : { demoHtml: style.demoHtml, designMd: style.designMd };
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
        build: toBuildOutcomeDto(created.build),
      };
    },

    async saveMockupImage(input: {
      fileName: string;
      extension: "png" | "pdf";
      bytes: Uint8Array<ArrayBuffer>;
    }): Promise<DesignSaveImageResultDto> {
      // 没接宿主能力就照实说 —— 而不是返回一个假的成功。
      if (exporter === undefined) return { ok: false, reason: "failed", detail: "saving is unavailable" };

      const target = await exporter.chooseSaveFile({
        suggestedName: `${input.fileName}.${input.extension}`,
        extension: input.extension,
      });
      // 取消不是错误:界面不该为此报红。
      if (target === null) return { ok: false, reason: "cancelled" };

      try {
        await exporter.writeFile(target, input.bytes);
        return { ok: true, path: target };
      } catch (error) {
        return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
      }
    },

    async copyMockupImage(input: { bytes: Uint8Array<ArrayBuffer> }): Promise<boolean> {
      if (clipboard === undefined) return false;
      return await clipboard.writeImage(input.bytes);
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

/** 打开一份设计的 IPC 形状。`openDesign` 与 `refreshDesign` 共用它,于是两者不可能漂开。 */
function toOpenedDto(opened: OpenedDesign): DesignOpenedDto {
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
}

/** `null` = 这一侧没启用构建,而不是"构建成功了"。 */
function toBuildOutcomeDto(build: DesignBuildResult | null): DesignBuildOutcomeDto | null {
  if (build === null) return null;
  return build.ok ? { ok: true } : { ok: false, code: build.code, detail: build.detail };
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
    updatedAt: summary.updatedAt,
  };
}
