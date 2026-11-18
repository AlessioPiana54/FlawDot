import { readFileSync } from "node:fs";

/** A result of axe recorded from the real engine on a page of test/fixtures/site. */
export function savedAxeResult(name: "violations" | "many" | "frames" | "clean"): unknown {
  const url = new URL(`../fixtures/axe-results/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}
