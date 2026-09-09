import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/renderer/features/thread/*.test.ts"],
  },
});
