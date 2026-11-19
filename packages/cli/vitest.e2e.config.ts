import { defineConfig } from "vitest/config";

// The tests of the built file (`dist/index.js`), run by `pnpm --filter @flawdot/cli test:dist` after a build and by CI.
// Not part of `check:task`: they need the build and Chromium.
export default defineConfig({
  test: { include: ["e2e/**/*.e2e.ts"], testTimeout: 90_000, hookTimeout: 30_000 },
});
