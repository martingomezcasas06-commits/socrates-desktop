import { defineConfig } from "vitest/config";

// Unit tests only. tests/*.spec.ts are Playwright layout tests (npm run test:panel);
// without this, Vitest's default pattern collects them too and fails.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
