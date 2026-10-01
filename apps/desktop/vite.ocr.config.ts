import { defineConfig, type Plugin } from "vite";

/**
 * OCR 运行器的页面构建。
 *
 * **单独一个构建**(而不是塞进 renderer):运行器页面与主界面没有一行共享代码 —— 它不 import
 * React、不 import 应用状态,只 import `@ocr-web/core`。混在一起会让"主界面改个组件"
 * 有机会影响这个隐藏窗口,而反过来它也没必要跟着 renderer 的 chunk 划分走。
 *
 * 产物落在 `dist/ocr-runner/`,由 `wordless-ocr://runner/*` 协议供给(打包时整个目录进
 * `resources/ocr-runner`)。
 */
/**
 * 剔掉 vite 顺手打进来的 onnxruntime wasm。
 *
 * `@ocr-web/core` 会 import `onnxruntime-web`,而它的胶水里有一句按 `import.meta.url` 取
 * `.wasm` 的写法 —— vite 于是把 **jsep 版(25.9MB,带 WebGPU)** 当成资产一起吐了出来。
 * 但运行时我们是通过 `wasmPaths` 指到 `wordless-ocr://assets/ort/` 的 **CPU 版(12.8MB)**,
 * 这份产物永远不会被取用:留着既多 26MB,又埋下"两个版本 wasm 同时在包里"的隐患。
 *
 * open-vetta 的 runner 构建做的是同一件事(见其 `vetta-ocr-runner-copy-assets`)。
 */
function dropBundledOrtWasm(): Plugin {
  return {
    name: "wordless-ocr-drop-bundled-ort-wasm",
    generateBundle(_options, bundle) {
      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === "asset" && fileName.includes("ort-wasm") && fileName.endsWith(".wasm")) delete bundle[fileName];
      }
    },
  };
}

export default defineConfig({
  plugins: [dropBundledOrtWasm()],
  base: "./",
  root: "src/ocr-runner",
  build: {
    outDir: "../../dist/ocr-runner",
    emptyOutDir: true,
    // Electron 的 Chromium 版本由我们决定,不需要为老浏览器降级。
    target: "chrome128",
    // 页面本身很小;wasm 与模型是运行时按 URL 取的,不进 bundle。
    assetsInlineLimit: 0,
  },
});
