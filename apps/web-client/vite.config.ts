import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * 浏览器客户端。
 *
 * 样式**复用桌面端的 token**(`@wordless/ui-kit/styles.css`)与同一套 Tailwind v4 类名 ——
 * 于是"和桌面端一致"不是靠人肉对齐,而是同一份变量。
 */
export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: { host: "127.0.0.1", port: 5273 },
	build: { outDir: "dist", emptyOutDir: true },
});
