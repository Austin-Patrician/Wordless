import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { protocol } from "electron";
import { OCR_ASSET_HEADERS, OCR_SCHEME, contentTypeFor, parseOcrUrl, type OcrAssetRoot } from "../ocr/ocr-asset-request";

/**
 * `wordless-ocr://` 协议:把运行器页面与 OCR 资产喂给那个隐藏窗口。
 *
 * 只做接线:URL 解析、路径约束、响应头都在纯模块里(`ocr-asset-request.ts`),各自有测试。
 * 这里是唯一 import Electron 的地方。
 *
 * 为什么不用 `file://`(open-vetta 的选择):
 * - `file://` 下拿不到跨源隔离,多线程 WASM 直接没戏,只能单线程;
 * - 他们为了绕过 CORS 把 `webSecurity` 关掉了。我们用自己的协议,`webSecurity` 保持开启。
 */

export interface OcrAssetRoots {
  /** 运行器页面与它的 JS(`dist/ocr-runner`,打包后在 `resources/ocr-runner`)。 */
  runner: string;
  /** `resources/ocr/ort` 与 `resources/ocr/models` 的父目录。 */
  assets: string;
}

/**
 * 把 scheme 登记成标准 scheme。
 *
 * **必须在 `app.whenReady()` 之前调用**。`standard: true` 让相对 URL 能解析(页面里的
 * `./main.js` 要靠它);`secure: true` 让页面被当作安全上下文(wasm 与 `SharedArrayBuffer`
 * 都要求它);`supportFetchAPI: true` 让 onnxruntime 的 fetch 能取模型。
 */
export function registerOcrScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: OCR_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // **必须的**:`wordless-ocr://runner`(页面)与 `wordless-ocr://assets`(模型)是两个源
        // (标准 scheme 下 host 属于 origin),所以取模型是一次跨源 fetch。不给这个权限,
        // Chromium 会直接拦掉("Cross origin requests are only supported for protocol schemes:
        // chrome, …, https"),运行器只能报 assets-missing —— 界面就变成"这个构建没有文字识别"。
        corsEnabled: true,
      },
    },
  ]);
}

function rootDirectory(roots: OcrAssetRoots, root: OcrAssetRoot): string {
  if (root === "runner") return roots.runner;
  return join(roots.assets, root);
}

export function registerOcrProtocol(roots: OcrAssetRoots): void {
  protocol.handle(OCR_SCHEME, async (request) => {
    const route = parseOcrUrl(request.url);
    if (route === null) return new Response("Not found", { status: 404, headers: { ...OCR_ASSET_HEADERS } });

    const root = resolve(rootDirectory(roots, route.root));
    const file = resolve(root, route.relative);
    // 纯模块已经把 `..` 与奇怪字符挡掉了,这里是第二道闸:解析之后必须仍在根目录内。
    if (file !== root && !file.startsWith(`${root}/`)) {
      return new Response("Not found", { status: 404, headers: { ...OCR_ASSET_HEADERS } });
    }

    try {
      const bytes = await readFile(file);
      return new Response(bytes, {
        headers: {
          "content-type": contentTypeFor(route.relative),
          ...OCR_ASSET_HEADERS,
        },
      });
    } catch {
      // 读不到就是 404:缺资产是**正常状态**(构建时可以 `WORDLESS_SKIP_OCR=1`),
      // 运行器会把这类失败归到 `assets-missing`,界面如实说"未就绪"。
      return new Response("Not found", { status: 404, headers: { ...OCR_ASSET_HEADERS } });
    }
  });
}
