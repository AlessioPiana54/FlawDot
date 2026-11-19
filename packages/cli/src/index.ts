#!/usr/bin/env node
import pkg from "../package.json" with { type: "json" };
import { checkNode } from "./env.js";
import { systemIo } from "./io.js";

// The executable: no logic of its own. The Node version is checked before the rest is loaded, so an old Node reads a
// clear message and not an error about syntax or a missing function.
const tooOld = checkNode(process.versions.node);
if (tooOld !== null) {
  process.stderr.write(`${tooOld}\n`);
  process.exit(1);
}

const { main } = await import("./main.js");
const code = await main(process.argv.slice(2), systemIo(), pkg.version);
process.exitCode = code;
// Chromium or a pipe can keep the process alive after everything is closed: give it a moment, then end it.
setTimeout(() => {
  process.exit(code);
}, 3000).unref();
