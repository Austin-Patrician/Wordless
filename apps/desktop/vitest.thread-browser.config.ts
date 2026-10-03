import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * 把 `resources/ocr` 挂在 `/ocr/*` 上,给端到端那条测试用。
 *
 * 那条测试要跑**真模型**(21.5MB ONNX + 12.8MB wasm):只有真跑一次,才能证明"这套资产 + 这版
 * onnxruntime-web"在浏览器里真的能出字 —— 假引擎的测试证明不了这件事。
 */
function serveOcrAssets(): Plugin {
  const root = resolve(import.meta.dirname, "resources/ocr");
  const types: Record<string, string> = {
    ".wasm": "application/wasm",
    ".onnx": "application/octet-stream",
    ".txt": "text/plain; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  };
  return {
    name: "wordless-ocr-test-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // vite 的 dev server 会给动态 import 的 URL 挂上 `?import` —— 取路径前必须去掉 query,
        // 否则 existsSync 永远找不到文件(端到端测试第一次跑就是这么 404 的)。
        const url = (request.url ?? "").split("?")[0] ?? "";
        if (!url.startsWith("/ocr/")) return next();
        const file = join(root, normalize(decodeURIComponent(url.slice("/ocr/".length))).replace(/^(\.\.[/\\])+/, ""));
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
          response.statusCode = 404;
          response.end("not found");
          return;
        }
        response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(response);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serveOcrAssets()],
  optimizeDeps: {
    include: [
      "@lexical/react/LexicalComposer",
      "@lexical/react/LexicalComposerContext",
      "@lexical/react/LexicalContentEditable",
      "@lexical/react/LexicalEditorRefPlugin",
      "@lexical/react/LexicalErrorBoundary",
      "@lexical/react/LexicalHistoryPlugin",
      "@lexical/react/LexicalOnChangePlugin",
      "@lexical/react/LexicalPlainTextPlugin",
      "lexical",
      "@radix-ui/react-context-menu",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-hover-card",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-select",
      "@radix-ui/react-separator",
      "@radix-ui/react-slider",
      "@radix-ui/react-slot",
      "@radix-ui/react-switch",
      "@radix-ui/react-tooltip",
      "class-variance-authority",
      "clsx",
      "highlight.js/lib/core",
      "highlight.js/lib/languages/bash",
      "highlight.js/lib/languages/c",
      "highlight.js/lib/languages/cpp",
      "highlight.js/lib/languages/csharp",
      "highlight.js/lib/languages/css",
      "highlight.js/lib/languages/diff",
      "highlight.js/lib/languages/go",
      "highlight.js/lib/languages/java",
      "highlight.js/lib/languages/javascript",
      "highlight.js/lib/languages/json",
      "highlight.js/lib/languages/markdown",
      "highlight.js/lib/languages/powershell",
      "highlight.js/lib/languages/python",
      "highlight.js/lib/languages/rust",
      "highlight.js/lib/languages/sql",
      "highlight.js/lib/languages/typescript",
      "highlight.js/lib/languages/xml",
      "highlight.js/lib/languages/yaml",
      "@xyflow/react",
      "zustand",
      "lucide-react",
      "mermaid",
      "micromark-util-character",
      "react-markdown",
      "rehype-katex",
      "remark-gfm",
      "remark-math",
      "tailwind-merge",
    ],
  },
  test: {
    browser: {
      enabled: true,
      headless: true,
      instances: [{ browser: "chromium" }],
      provider: playwright(),
    },
    include: [
      "test/thread-production-row.browser.test.tsx",
      "test/turn-token-usage.browser.test.tsx",
      "test/assistant-message-footer.browser.test.tsx",
      "test/sidebar-settings-menu.browser.test.tsx",
      "test/sidebar-nav-more.browser.test.tsx",
      "test/thread-selection-menu.browser.test.tsx",
      "test/global-shortcuts.browser.test.tsx",
      "test/shortcut-preferences.browser.test.tsx",
      "test/shortcut-settings.browser.test.tsx",
      "test/shortcut-scope.browser.test.tsx",
      "test/translation-settings.browser.test.tsx",
      "test/thread-virtuoso.browser.test.tsx",
      "test/automation-form.browser.test.tsx",
      "test/notifications-settings.browser.test.tsx",
      "test/model-picker.browser.test.tsx",
      "test/design-activity.browser.test.tsx",
      "test/session-context-panel.browser.test.tsx",
      "test/design-canvas.browser.test.tsx",
      "test/design-live-frame-release.browser.test.tsx",
      "test/environment-settings.browser.test.tsx",
    "test/remote-access-settings.browser.test.tsx",
      // 网页端线程的渲染冒烟:白屏就是渲染时抛异常,而网页端此前没有渲染测试。
      "test/remote-web-thread.browser.test.tsx",
      // 外壳的页面切换:主题 hook 写错位置会让"连上之后"白屏,这一条守它。
      "test/remote-web-app.browser.test.tsx",
      // 网页端 markdown 的公式与图表:只能在真浏览器里验(KaTeX 排版 + mermaid 懒加载真渲染)。
      "test/remote-web-markdown.browser.test.tsx",
      "test/onboarding-environment.browser.test.tsx",
      "test/design-style-strip.browser.test.tsx",
      "test/design-workspace.browser.test.tsx",
      "test/design-layout-probe.browser.test.tsx",
      "test/mockup-render.browser.test.tsx",
      "test/mockup-dialog.browser.test.tsx",
      "test/design-library.browser.test.tsx",
      "test/design-cover.browser.test.tsx",
      // 封面这一层只能在真浏览器里验(IndexedDB + canvas)。
      "test/composer-attachments.browser.test.tsx",
      // 端到端:真模型 + 真 wasm(慢,见文件头的说明)。
      "test/ocr-engine.browser.test.tsx",
      "test/notification-center.browser.test.tsx",
      // 工具图标映射(漏一条映射是静默的:那行工具会变成通用扳手)。
      "test/tool-icon-map.browser.test.tsx",
    ],
  },
});
