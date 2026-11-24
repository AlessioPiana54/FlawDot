# @flawdot/cli

The command line of FlawDot, and the **composition root**: the one place that knows every adapter by name and puts them
together. It is a private workspace package, built into the single file `dist/index.js` that `npx flawdot` runs.

```
flawdot mcp          serve Claude Code over MCP, on stdin and stdout
flawdot --version
flawdot --help
```

`flawdot` with no command will start the web app (Task 38); for now it says so and points to `flawdot mcp`.

## Try it with Claude Code

```
pnpm browsers                       # Chromium, once per machine
pnpm --filter @flawdot/cli build
claude mcp add flawdot-dev -- node packages/cli/dist/index.js mcp
```

Then ask Claude Code to analyze a page. To look at the server alone:
`npx @modelcontextprotocol/inspector node packages/cli/dist/index.js mcp`.

## How it is put together

| File              | What it does                                                                                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`        | The executable (it has the shebang). It checks the Node version _before_ loading anything, then runs `main`, then ends the process.                                                                                    |
| `main.ts`         | The arguments, and the exit code. Heavy modules (browser, image library, MCP SDK) are loaded only by the command that needs them.                                                                                      |
| `io.ts`           | `Io`: what the command line needs of the process. `systemIo()` is, with `index.ts`, the only place that reads `process`; a test gives pipes and a fake environment.                                                    |
| `compose-core.ts` | `composeCore`: the adapters, built once (capture, axe, the annotator, storage, the browser). `createKernel("mcp" \| "web")` puts them in a kernel.                                                                     |
| `compose-mcp.ts`  | `composeMcp`: the MCP server on that kernel. The AI part is done by Claude Code, so `ai` is `none`.                                                                                                                    |
| `run-mcp.ts`      | `flawdot mcp`: serves until the client closes the pipe or the user stops it, then stops _in order_: the server (it cancels the run that is going), then the browser. Exit code 0, or 1 if it could not start or close. |
| `system.ts`       | The clock of the machine, and ULIDs that grow strictly in the order they are made (also within one millisecond).                                                                                                       |
| `env.ts`          | The Node check (24 or newer) and `FLAWDOT_HOME`, which is read here and nowhere else.                                                                                                                                  |

`FLAWDOT_HOME` (default `~/.flawdot`) is where the pictures go, under `artifacts/runs/<run id>/`. They are never deleted.

## The build

`tsdown` bundles the packages of the workspace, the MCP SDK and Zod into `dist/`. What stays outside, as `dependencies`, is
what cannot be bundled: `sharp` (native), `playwright-core`, `axe-core` and `@axe-core/playwright` (it reads `axe.min.js`
from disk). `minify` must stay off: capture sends functions to the page as text, and a renamed helper would not exist there.
`deps.onlyBundle` lists the only packages from `node_modules` that may end up inside; a new one fails the build.

`pnpm --filter @flawdot/cli test:dist` builds and then starts the built file as a real process over real pipes, from another
folder, with a real Chromium. It is not part of `check:task` (it needs the build); CI runs it.

## Known limits

Chromium is not installed by FlawDot yet: if it is missing, the message says `pnpm browsers`, which only helps who works on
the repository (Task 38 brings the guided install). The runs are kept in memory (Task 23 brings SQLite), so a result can be
asked for only while the server runs.
