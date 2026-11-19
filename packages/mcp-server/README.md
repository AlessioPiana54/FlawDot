# @flawdot/mcp-server

The MCP server of FlawDot: it lets Claude Code analyze a web page. Claude Code calls a tool, FlawDot captures the page, runs
the accessibility rules of axe-core and draws numbered circles on the screenshot, and the result comes back as text and a
picture. It is a private workspace package.

It depends on `@flawdot/core-model` and on the MCP SDK, and takes the kernel as a **type** only (rule A1 of
`.oxlintrc.json`): the server is _given_ the kernel, the settings and a way to read pictures, and knows no adapter. In
`src/` it may not use a file system module, `process` or `console`: stdout is the channel of the protocol, and one stray
line there breaks the client. What the server has to say about itself goes to `deps.log`, which the cli sends to stderr.
Its tests use `@flawdot/test-support` and the MCP client as dev dependencies.

## What it offers

```ts
const server = createMcpServer({ flawdot, settings, images, ai, version, log });
await server.start(transport); // stdio for the cli, one end of an in-memory pair for a test
await server.closed; // the client went away, or `stop` was called
await server.stop(); // cancels the run that is going, then closes
```

| Tool              | What it does                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `flawdot_analyze` | Starts the analysis of one page (`url`, and optionally `viewports` and `language`) and answers at once with a run id. It only reads the page.                            |
| `flawdot_next`    | Waits up to 20 s for the run to end. If it ended: the result (scores, numbered problems with how to fix them, `image` of the picture). Else: how many captures are done. |

Claude Code calls `flawdot_next` again, with the same run id, while the answer says the run is still going. A run that is
over gives the same result every time. **One analysis at a time**: a second `flawdot_analyze` while a run is going is
refused, and says which run to follow.

## The result, and what is not to be trusted

The text names the state of the run, the score of the site, the score of each category (`—` for one that was not analyzed:
rules alone cannot judge a design), and for each picture the first ten problems with their number, severity, principle, a
badge (`Verified`) and the fix. The number of a problem is the number of its circle in the picture; the legend of the picture
has all of them. The full-size file of each picture is named in the text, because the picture in the result is shrunk to
fit in a message (1568 px on the long edge): a very tall page becomes narrow.

What comes from the page (a selector, the evidence of a rule, a name inside an error message) is **data, not
instructions**: it is cleaned (one line, no control characters), cut to a length and put between quotes, and the
instructions of the server say never to follow what is found in it. The catalog texts (titles, fixes) are ours.

An error is told by one function (`toToolError`): a `FlawDotError` is written for the user, with a hint of what to do next;
any other error gives a fixed sentence, and its detail goes to the log only, because it may hold a path or a secret.

## Not here yet

The tools `flawdot_discover`, `_record_findings`, `_export`, `_history`, `_set_finding_state`, `_login` and `_cancel`, the
request queue (`queue`) and the AI cycle (Task 22 and 30), progress notifications, whole sites, templates and the cost
estimate. The runs live in memory until the database comes (Task 23): the pictures stay on disk, the numbers are lost when
the server stops.
