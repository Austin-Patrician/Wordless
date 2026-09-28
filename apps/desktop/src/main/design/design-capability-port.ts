import { LAYOUT_PROBE_EXPRESSION, type DesignPort, type LayoutFinding } from "@wordless/capability-design";
import type { DesignStore } from "./design-store.ts";
import { designFrameUrl } from "./design-url.ts";
import type { OffscreenEvaluatePort, RasterPort } from "./raster-port.ts";
import { RasterPool } from "./raster-pool.ts";

/**
 * 把设计能力接到真实实现上。
 *
 * 这是能力与宿主之间**唯一**的适配层:能力不知道 Electron、不知道 SQLite、不知道注册表,
 * 只认自己的端口;这里知道全部,也只做翻译。
 */

export interface DesignCapabilityPortDeps {
  store: DesignStore;
  /** 光栅化(截图)。 */
  raster: RasterPort;
  /** 在离屏视图里求值(布局探针)。 */
  evaluator: OffscreenEvaluatePort;
  /** 光栅并发与超时。与 IPC 那条路径共用同一份预算。 */
  poolOptions: { concurrency: number; timeoutMs: number };
  /** 当前会话的工作区根 —— 设计包是工作区里的目录。 */
  workspaceRoot: string;
}

export function createDesignCapabilityPort(deps: DesignCapabilityPortDeps): DesignPort {
  // 能力侧的光栅池与 IPC 那条路径各自持有池:池是有状态资源(在途控制器),共用会让
  // "取消"从画布传到 agent 工具上。
  const pool = new RasterPool({ port: deps.raster, ...deps.poolOptions });

  return {
    async list() {
      const designs = await deps.store.listDesigns(deps.workspaceRoot);
      return designs.map((design) => ({ path: design.path, name: design.name, frameCount: design.frameCount }));
    },

    async read(designPath: string) {
      const description = await deps.store.describeDesign(designPath);
      if (description === null) return null;
      return {
        path: description.path,
        name: description.name,
        mode: description.mode,
        style: description.style,
        hasDesignDoc: description.hasDesignDoc,
        frames: description.frames.map((frame) => ({
          id: frame.id,
          title: frame.title,
          file: frame.file,
          declaredSize: frame.declaredSize,
          fileExists: frame.fileExists,
        })),
      };
    },

    async create(input) {
      return await deps.store.createDesign({
        root: deps.workspaceRoot,
        name: input.name,
        title: input.title,
        frameWidth: input.frameWidth,
        frameHeight: input.frameHeight,
      });
    },

    async screenshot(designPath: string, frameId: string) {
      const opened = await deps.store.openDesign(designPath);
      const frame = opened?.manifest.frames.find((candidate) => candidate.id === frameId);
      if (opened === null || frame === undefined) {
        return { ok: false as const, frameId, reason: "no such frame" };
      }

      const results = await pool.run([
        {
          key: `${frameId}@1`,
          url: designFrameUrl(opened.summary.id, frameId),
          width: frame.width,
          height: frame.height,
          // 1 倍:Electron 的离屏渲染没有 per-window 设备像素比,而 setZoomFactor 会重排
          // 布局。见 electron-offscreen-raster.ts 的说明。
          pixelRatio: 1,
        },
      ]);

      const result = results[0];
      if (result === undefined || !result.ok) {
        return { ok: false as const, frameId, reason: result === undefined ? "no result" : result.code };
      }
      return {
        ok: true as const,
        frameId,
        mimeType: "image/jpeg",
        data: base64FromBytes(result.bytes),
      };
    },

    async inspect(designPath: string, frameIds: readonly string[]): Promise<LayoutFinding[]> {
      const opened = await deps.store.openDesign(designPath);
      if (opened === null) return [];

      const byId = new Map(opened.manifest.frames.map((frame) => [frame.id, frame]));
      const controller = new AbortController();
      const findings: LayoutFinding[] = [];

      for (const frameId of frameIds) {
        const frame = byId.get(frameId);
        if (frame === undefined) continue;
        const result = await deps.evaluator.evaluate(
          {
            url: designFrameUrl(opened.summary.id, frameId),
            width: frame.width,
            height: frame.height,
            expression: LAYOUT_PROBE_EXPRESSION,
          },
          controller.signal,
        );
        if (!result.ok) continue;
        // 探针是在页面里跑的,返回值的形状由它自己保证;这里只做一次形状收敛,坏数据丢掉。
        for (const finding of asFindings(result.value)) {
          findings.push({ ...finding, selector: `${frameId} ${finding.selector}` });
        }
      }
      return findings;
    },
  };
}

function asFindings(value: unknown): Omit<LayoutFinding, "frameId">[] {
  if (!Array.isArray(value)) return [];
  const findings: Omit<LayoutFinding, "frameId">[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    if (typeof record.kind !== "string" || typeof record.selector !== "string" || typeof record.detail !== "string") {
      continue;
    }
    findings.push({ kind: record.kind, selector: record.selector, detail: record.detail });
  }
  return findings;
}

/** 字节转 base64。工具结果的图片块要的就是它。 */
function base64FromBytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
