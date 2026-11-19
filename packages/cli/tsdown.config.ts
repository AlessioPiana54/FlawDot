import { defineConfig } from "tsdown";

// The bundle is what `npx flawdot` runs. The packages of the workspace, the MCP SDK and Zod go inside it (they are
// devDependencies of the cli). What stays outside, as dependencies, is what cannot be bundled: sharp and Chromium's
// driver are native or read their own files, and axe-core is read from disk by @axe-core/playwright.
// `minify` must stay off: capture sends functions to the page as text, and a renamed helper would not exist there.
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  minify: false,
  dts: false,
  fixedExtension: false,
  // The only packages from node_modules that may end up inside the bundle: a new one that does is a surprise to look at.
  deps: { onlyBundle: ["zod", "@modelcontextprotocol/server", "@modelcontextprotocol/core"] },
});
