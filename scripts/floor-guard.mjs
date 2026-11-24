#!/usr/bin/env node
// floor-guard.mjs: diff-scoped enforcement of the quality floor (docs/CONSTRAINTS.md §2 and §6).
// Usage: node scripts/floor-guard.mjs [--base <ref>]   (default base: origin/main, then main)
// Exit codes: 0 clean, 1 floor violation, 2 the guard could not run. A 2 never reads as a 0.
// Adapted from the constraint-driven-development reference. Only moves that LOWER the bar are reported.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const argBase = (() => {
  const i = process.argv.indexOf("--base");
  return i > -1 ? process.argv[i + 1] : undefined;
})();

// `git diff --no-index` exits 1 whenever the two sides differ (the normal case for a new file),
// so that output is kept. Any other failure is null, and null never reads as clean.
const git = (args, { diffExit = false } = {}) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return diffExit && e.status === 1 && typeof e.stdout === "string" ? e.stdout : null;
  }
};
const bail = (msg) => {
  console.error("floor-guard: " + msg);
  process.exit(2);
};

const top = git(["rev-parse", "--show-toplevel"])?.trim();
if (!top) bail("not inside a git work tree");
process.chdir(top);

const candidates = argBase ? [argBase] : ["origin/main", "main"];
let mergeBase = null;
for (const ref of candidates) {
  mergeBase = git(["merge-base", ref, "HEAD"])?.trim() ?? null;
  if (mergeBase) break;
}
if (!mergeBase) bail("no merge base against " + candidates.join(" or "));

const findings = [];
const flag = (rule, f, text) => {
  const entry = { rule, file: f, text: text.trim().slice(0, 140) };
  if (
    !findings.some((x) => x.rule === entry.rule && x.file === entry.file && x.text === entry.text)
  ) {
    findings.push(entry);
  }
};

// Two passes: against the merge base (everything on the branch) and against HEAD (uncommitted work).
// The second one matters for files that are new on the branch: a threshold lowered after the commit
// that created the file leaves no removed line against the merge base.
const scan = (baseRef) => {
  const tracked = git(["diff", "--unified=0", baseRef, "--"]);
  if (tracked === null) bail("could not diff against " + baseRef);
  const untrackedFiles = git(["ls-files", "--others", "--exclude-standard"]);
  if (untrackedFiles === null) bail("could not list untracked files");
  const untracked = untrackedFiles
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => {
      const d = git(["diff", "--no-index", "--unified=0", "/dev/null", f], { diffExit: true });
      if (d === null) bail("could not diff untracked file " + f);
      return d;
    })
    .join("\n");
  const diff = tracked + "\n" + untracked;

  // Walk the diff. `---`/`+++` are file headers only between a `diff` line and the first `@@` hunk.
  const added = [];
  const removed = [];
  const deleted = [];
  const pathOf = (s) => s.replace(/^[ab]\//, "").replace(/\r$/, "");
  let file = "";
  let oldFile = "";
  let inHeader = false;
  for (const raw of diff.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("diff ")) inHeader = true;
    else if (line.startsWith("@@")) inHeader = false;
    else if (inHeader) {
      if (line.startsWith("--- ")) oldFile = pathOf(line.slice(4));
      else if (line.startsWith("+++ ")) {
        const newFile = pathOf(line.slice(4));
        file = newFile === "/dev/null" ? oldFile : newFile;
        if (newFile === "/dev/null") deleted.push(file);
      }
    } else if (line.startsWith("+")) added.push({ file, text: line.slice(1) });
    else if (line.startsWith("-")) removed.push({ file, text: line.slice(1) });
  }

  const isCode = (f) =>
    /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f) && f !== "scripts/floor-guard.mjs";
  const isTest = (f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

  // Rule 1: silenced checker.
  const SUPPRESSIONS =
    /@ts-ignore|@ts-nocheck|@ts-expect-error\s*$|eslint-disable|oxlint-disable|biome-ignore|v8 ignore|istanbul ignore|c8 ignore|nosemgrep|gitleaks:allow/;
  // Rule 3: unfinished work.
  const STUBS =
    /throw new Error\(\s*["'`]Not implemented|catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}|\bTODO\b|\bFIXME\b/i;
  // Rule 2: a test made easier.
  const SKIPS = /\.(skip|only|todo)\b|\bit\.fails\b|\btest\.fails\b|\bxit\(|\bxdescribe\(/;
  // Rule 4: secrets (name only, never the value).
  const SECRETS = /sk-ant-[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/;

  for (const { file: f, text } of added) {
    if (SECRETS.test(text)) flag("secret", f, "(value hidden)");
    if (!isCode(f)) continue;
    if (SUPPRESSIONS.test(text)) flag("silenced-checker", f, text);
    if (STUBS.test(text)) flag("unfinished-work", f, text);
    if (isTest(f) && SKIPS.test(text)) flag("test-made-easier", f, text);
    if (/api\.anthropic\.com/.test(text) && isTest(f)) flag("real-ai-call-in-test", f, text);
  }

  for (const f of deleted) if (isTest(f)) flag("test-deleted", f, "file deleted");
  for (const { file: f, text } of removed) {
    if (isTest(f) && !deleted.includes(f) && /\b(expect|assert)\b/.test(text)) {
      flag("assertion-removed", f, text);
    }
  }

  // Rule 6: thresholds and rules in the TRACKED config files (CONSTRAINTS §1). docs/ is not in git,
  // so the numbers live in these files and this is where a loosening shows up.
  // Fixed regex (no RegExp built from a variable): the key is matched in group 1 and filtered after.
  const THRESHOLD = /\b(lines|branches|functions|statements)\s*:\s*(\d+(?:\.\d+)?)/;
  const nums = (lines, key) =>
    lines
      .map((l) => THRESHOLD.exec(l.text))
      .filter((m) => m && m[1] === key)
      .map((m) => Number(m[2]));
  const configFiles = new Set(
    [...added, ...removed]
      .map((l) => l.file)
      .filter((f) => /(^|\/)vitest\.config\.[cm]?ts$/.test(f)),
  );
  for (const f of configFiles) {
    const rem = removed.filter((l) => l.file === f);
    const add = added.filter((l) => l.file === f);
    for (const key of ["lines", "branches", "functions", "statements"]) {
      const before = nums(rem, key);
      const after = nums(add, key);
      before.forEach((b, i) => {
        const a = after[i];
        if (a === undefined) flag("threshold-removed", f, `${key}: ${b}`);
        else if (a < b) flag("threshold-loosened", f, `${key}: ${b} -> ${a}`);
      });
    }
    if (
      rem.some((l) => /perFile\s*:\s*true/.test(l.text)) &&
      !add.some((l) => /perFile\s*:\s*true/.test(l.text))
    ) {
      flag("threshold-loosened", f, "perFile: true removed");
    }
  }

  // Rule 6, the limits of time: scripts/bench-limits.json says, per benchmark, how many milliseconds are a warning
  // and how many a failure (CONSTRAINTS §4), and scripts/check-time-limits.json says how many seconds `check:task` may
  // take before it warns and before it fails (§5). A HIGHER number is the loosened one. A number that was removed
  // without another in its place is a limit that is gone. Same pairing as the coverage thresholds above.
  const TIME_LIMIT_FILES = [
    { file: "scripts/bench-limits.json", keys: ["warnMs", "failMs"] },
    { file: "scripts/check-time-limits.json", keys: ["warnSeconds", "failSeconds"] },
  ];
  const TIME_LIMIT = /"(warnMs|failMs|warnSeconds|failSeconds)"\s*:\s*(\d+(?:\.\d+)?)/;
  const limitNums = (lines, file, key) =>
    lines
      .filter((l) => l.file === file)
      .map((l) => TIME_LIMIT.exec(l.text))
      .filter((m) => m && m[1] === key)
      .map((m) => Number(m[2]));
  for (const { file, keys } of TIME_LIMIT_FILES) {
    for (const key of keys) {
      const before = limitNums(removed, file, key);
      const after = limitNums(added, file, key);
      before.forEach((b, i) => {
        const a = after[i];
        if (a === undefined) flag("threshold-removed", file, `${key}: ${b}`);
        else if (a > b) flag("threshold-loosened", file, `${key}: ${b} -> ${a}`);
      });
    }
    if (deleted.includes(file)) flag("threshold-removed", file, "file deleted");
  }

  // Exceptions of docs/CONSTRAINTS.md section 7 that are written in these files. Each is the exact text the user
  // approved: a new "exclude" in the coverage configuration, or a different EXCLUDED pattern in diff-coverage, is
  // a new exception and needs the user to approve it (and to add its line here).
  const APPROVED_COVERAGE_EXCLUDE = 'exclude: ["packages/capture/src/in-page/**"],'; // E1
  const APPROVED_DIFF_EXCLUDED =
    "const EXCLUDED = /^packages\\/(kernel|core-model)\\/|^packages\\/capture\\/src\\/in-page\\//;"; // E1
  for (const f of configFiles) {
    for (const l of added.filter((a) => a.file === f)) {
      if (/\bexclude\s*:/.test(l.text) && l.text.trim() !== APPROVED_COVERAGE_EXCLUDE) {
        flag("exception-added", f, l.text.trim());
      }
    }
  }
  for (const l of added.filter((a) => a.file === "scripts/diff-coverage.mjs")) {
    if (l.text.includes("const EXCLUDED") && l.text.trim() !== APPROVED_DIFF_EXCLUDED) {
      flag("exception-added", l.file, l.text.trim());
    }
  }

  // A rule token that appears fewer times after the edit was removed or renamed away.
  const WATCHED = [
    {
      test: /(^|\/)\.oxlintrc\.json$/,
      tokens: ["no-restricted-imports", "import/no-cycle", "typeAware"],
    },
    {
      test: /^package\.json$/,
      tokens: ['"check:fast"', '"check:task"', '"check:full"', '"typecheck"', '"lint"', '"bench"'],
    },
    {
      test: /^\.github\/workflows\/.*\.ya?ml$/,
      tokens: ["- name:", "gitleaks", "osv-scanner", "semgrep", "pnpm bench"],
    },
    {
      test: /^scripts\/(quality-gate|diff-coverage|bench-gate|check-task)\.mjs$/,
      tokens: ["process.exit", "exitCode"],
    },
    {
      // The phases of the check at the end of a task: one that is dropped from the list is a check that is gone.
      test: /^scripts\/check-task\.mjs$/,
      tokens: [
        "check:fast",
        "floor-guard.mjs",
        "--coverage",
        "diff-coverage.mjs",
        "process.exit(1)",
      ],
    },
  ];
  const count = (lines, token) => lines.filter((l) => l.text.includes(token)).length;
  for (const { test, tokens } of WATCHED) {
    const files = new Set([...added, ...removed].map((l) => l.file).filter((f) => test.test(f)));
    for (const f of files) {
      const rem = removed.filter((l) => l.file === f);
      const add = added.filter((l) => l.file === f);
      for (const token of tokens) {
        if (count(rem, token) > count(add, token)) flag("rule-removed", f, token);
      }
    }
  }
};
scan(mergeBase);
scan("HEAD");

// E2 (docs/CONSTRAINTS.md section 7): osv-scanner reads an osv-scanner.toml in every folder it scans, and a file like
// that can ignore advisories, extend a date or override a package. So the guard does not look at single added lines
// (a different key, another file or another date would slip past them): EVERY osv-scanner.toml in the tree must be
// the one file the user approved, byte for byte (line endings aside). Changing it, even a comment, needs the user's
// approval and a new hash here.
const APPROVED_OSV_CONFIG = {
  path: "osv-scanner.toml",
  sha256: "2daaaa9a05cb75adf652fadf052a95879fd3e5a99ac241da87f7cf87c0c8b2bb",
};
const treeFiles = git(["ls-files", "--cached", "--others", "--exclude-standard"]);
if (treeFiles === null) bail("could not list the files of the tree");
for (const f of treeFiles.split("\n").filter((name) => /(^|\/)osv-scanner\.toml$/.test(name))) {
  if (!existsSync(f)) continue; // deleted: nothing is ignored any more
  const digest = createHash("sha256")
    .update(readFileSync(f, "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");
  if (f !== APPROVED_OSV_CONFIG.path || digest !== APPROVED_OSV_CONFIG.sha256) {
    flag("exception-added", f, "osv-scanner.toml is not the text approved for exception E2");
  }
}

if (findings.length === 0) {
  console.log("floor-guard: clean");
  process.exit(0);
}
console.error("floor-guard: " + findings.length + " floor violation(s):");
for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.text}`);
console.error(
  "\nEach is a move that lowers the bar. Fix the code, or ask the user to approve an exception.",
);
process.exit(1);
