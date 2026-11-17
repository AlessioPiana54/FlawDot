import { defineConfig } from "vitest/config";

// Coverage thresholds C1 and C2 of docs/CONSTRAINTS.md. Lowering a number needs the user's approval.
export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      // Exception E1 of docs/CONSTRAINTS.md section 7: code that runs inside the browser page (Playwright sends its
      // source text to Chromium) is not seen by the V8 of Node, so it cannot be measured here. The browser tests run it.
      exclude: ["packages/capture/src/in-page/**"],
      reporter: ["text", "lcov"],
      thresholds: {
        // C2: the core is pure logic, easy to test with fake ports.
        "packages/{kernel,core-model}/src/**": {
          lines: 90,
          branches: 90,
        },
        // C1: scoring, circle numbering and finding fingerprints decide every report.
        "packages/core-model/src/{scoring,numbering,finding}.ts": {
          lines: 100,
          branches: 100,
          functions: 100,
          statements: 100,
          perFile: true,
        },
      },
    },
  },
});
