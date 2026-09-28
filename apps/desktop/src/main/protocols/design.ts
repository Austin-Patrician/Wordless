import { protocol } from "electron";
import { NodeDesignFs, type DesignFs } from "../design/design-fs.ts";
import type { DesignRegistry } from "../design/design-registry.ts";
import { resolveDesignRequest } from "../design/design-request.ts";
import { DESIGN_SCHEME, parseDesignUrl } from "../design/design-url.ts";

/**
 * `wordless-design://` 协议。
 *
 * 只做接线:解析 URL、查注册表、落盘读取都在纯模块里,各自有测试。这里唯一 import
 * Electron 的地方。
 */

/**
 * 把设计协议登记为标准 scheme。
 *
 * **必须在 `app.whenReady()` 之前调用**,而且这一步不是可选的:
 *
 * - `standard: true` —— 相对 URL 才会解析。设计帧里写的 `../theme.css` / `../assets/x.png`
 *   依赖它;非标准 scheme 下这些引用根本不成立,而"源文件与产物用同一套相对引用"正是
 *   整个渲染模型的基础。
 * - `secure: true` —— 帧被当作安全上下文,页面自身的脚本行为与在 https 下一致。
 * - `supportFetchAPI: true` —— 帧内的 `fetch` 可用。
 *
 * 仓库里其它 `wordless-*` 协议没有登记成标准 scheme 也能工作,是因为它们只服务**单个
 * 自包含文档**(`<img src>`、单页 HTML);设计帧要加载相对资源,性质不同。
 */
export function registerDesignScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: DESIGN_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

export interface RegisterDesignProtocolOptions {
  registry: DesignRegistry;
  /** 路径约束判定。生产传 `WorkspacePathService#isWithinRoot`。 */
  isWithinRoot: (root: string, candidate: string) => boolean;
  /** 便于测试注入。 */
  fs?: DesignFs;
}

export function registerDesignProtocol(options: RegisterDesignProtocolOptions): void {
  const fs = options.fs ?? new NodeDesignFs();

  protocol.handle(DESIGN_SCHEME, async (request) => {
    const parsed = parseDesignUrl(request.url);
    if (parsed === null) return notFound();

    const resolved = await resolveDesignRequest({
      request: parsed,
      resolveDesign: (designId) => options.registry.resolve(designId),
      fs,
      isWithinRoot: options.isWithinRoot,
    });
    if (!resolved.ok) return notFound();

    try {
      const bytes = await fs.readBytes(resolved.path);
      return new Response(bytes, {
        headers: {
          "content-type": resolved.contentType,
          // 帧是用户/agent 写的 HTML:不要让浏览器按内容嗅探出别的类型。
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      // 解析成功但读取失败(例如刚好被删)。仍然是 404,不抛。
      return notFound();
    }
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
