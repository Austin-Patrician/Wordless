import { isAbsolute, join, resolve } from "node:path";
import type { DocumentFailureCode, DocumentOutcome, DocumentPort, DocumentRenderOutcome } from "@wordless/capability-documents";
import type { DocumentService } from "./document-service.ts";

/**
 * 把桌面端的文档服务适配成能力包声明的端口。
 *
 * 适配发生在这一层的原因与 OCR、浏览器、设计画布相同:能力包不该知道工作区、会话或
 * Electron。这里多做的一件事是**路径约束** —— 模型给的路径可能是相对的(甚至是 `../../`
 * 开头的),必须先落回会话工作区内才允许读。
 *
 * URL 那条不做路径约束(它没有路径),它的边界是宿主的出网策略(SSRF 判定 + 上限),
 * 那属于服务,不属于适配层。
 */
export interface DocumentPortOptions {
  workspaceRoot: string;
  /** 生产传 `WorkspacePathService#isWithinRoot`。 */
  isWithinRoot: (root: string, candidate: string) => boolean;
}

export function createDocumentPort(service: DocumentService, options: DocumentPortOptions): DocumentPort {
  const { workspaceRoot, isWithinRoot } = options;

  /**
   * 相对路径落回工作区,越界即拒 —— 三种入口走同一条,免得只有一条被加固。
   *
   * 返回的是**失败的公共形状**而不是某个方法的完整结果类型:读文本层与渲染页的成败形状不同
   * (一个有 `document`,一个有 `pages`),但失败那一半是同一个。
   */
  const inside = (
    path: string,
  ): { ok: true; path: string } | { ok: false; failure: { code: DocumentFailureCode; message: string } } => {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(join(workspaceRoot, path));
    if (!isWithinRoot(workspaceRoot, absolute)) {
      return { ok: false, failure: { code: "outside-workspace", message: `${path} is outside this session's workspace` } };
    }
    return { ok: true, path: absolute };
  };

  return {
    async readPdf(request, requestOptions): Promise<DocumentOutcome> {
      const resolved = inside(request.path);
      if (!resolved.ok) return { ok: false, ...resolved.failure };
      return await service.readPdf({ ...request, path: resolved.path }, requestOptions);
    },

    async renderPdfPages(request, requestOptions): Promise<DocumentRenderOutcome> {
      const resolved = inside(request.path);
      if (!resolved.ok) return { ok: false, ...resolved.failure };
      return await service.renderPdfPages({ ...request, path: resolved.path }, requestOptions);
    },

    async readDocx(request, requestOptions): Promise<DocumentOutcome> {
      const resolved = inside(request.path);
      if (!resolved.ok) return { ok: false, ...resolved.failure };
      return await service.readDocx({ ...request, path: resolved.path }, requestOptions);
    },

    async fetchUrl(request, requestOptions): Promise<DocumentOutcome> {
      return await service.fetchUrl(request, requestOptions);
    },
  };
}
