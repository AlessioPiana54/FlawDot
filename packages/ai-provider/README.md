# @flawdot/ai-provider

The ways an AI request gets answered, and the fake provider that lets every test run with no API key and no cost.

A request for one tile of a page (`AiAnalysisRequest`, from `core-model`) can be answered by the user's own key, by
Claude Code through the MCP server, or by nobody. The kernel only knows the port `AiFulfiller`; this package has the
adapters. The real Claude provider arrives with Task 35. Until then **nothing in this package reaches the network**.

## What is in it

| Export                                       | What it does                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFakeProvider({ fixturesDir })`        | An `AiProvider` that answers from saved files. Used by every test.                                                                                                                                                                                                                          |
| `createProviderFulfiller(provider, options)` | Mode `byok`. Asks a provider, tries again after a failure that can pass (at most 2 times, pauses of 500 and 1000 ms), checks the answer again.                                                                                                                                              |
| `createMcpFulfiller(queue, { timeoutMs? })`  | Mode `subscription`. Puts the request in the queue that Claude Code reads and waits for the answer it records (10 minutes by default).                                                                                                                                                      |
| `recordFixtures(options)`                    | Saves the answers of a real provider as fixtures. Spends API money, so it needs `confirmSpend: true`. Run by a person with `record-fixtures`, never by a test. If it stops half way it throws `RecordInterrupted`, with the code of the failure and the files already written in `partial`. |
| `fixtureKey(request)`, `writeFixture(...)`   | The name of the fixture of a request, and a way to write one. The analyzers' tests (Tasks 19 to 21) use them with the request their analyzer really builds.                                                                                                                                 |

The fulfiller of "nobody answers" (`createNoAiFulfiller`) is in `@flawdot/kernel`: it was already there, with its tests.
All the fulfillers pass the same contract, `runAiFulfillerContract` of `@flawdot/test-support`, and the providers the
contract `runAiProviderContract`. The real provider of Task 35 will have to pass the second one unchanged.

## The fixtures

A fixture is a JSON file named `<hash>.json` in the `fixturesDir`. The hash is the SHA-256 of the canonical JSON (keys in
order) of: `analyzer`, `promptVersion`, `language`, `viewport`, `tile`, `pageUrl`, `instructions`, `elements` and
`responseSchema`. `requestId`, `runId` and the file of the image are **not** in it: they change at every run.

Three kinds, all checked when they are loaded (a broken fixture is an `INTERNAL` error that names the file):

```json
{ "kind": "answer", "response": { "findings": [] }, "model": "claude-sonnet-5-5" }
{ "kind": "error", "code": "AI_RATE_LIMIT", "message": "Busy." }
{ "kind": "sequence", "steps": [ { "kind": "error", "code": "AI_RATE_LIMIT", "message": "Busy." }, { "kind": "answer", "...": "..." } ] }
```

An `error` can say `"retryable": true|false`; without it the code decides. In a `sequence` each call takes the next step and
the last one repeats ("429, 429, then an answer"). `describe` and `recordedAt` are for people and are ignored.

A request with no fixture is an error that names the request (never its path or query) and the hash. It never falls
back to the network.

**A change of the prompt makes the fixtures stale.** The instructions and the schema of the answer are in the hash, so
a new `promptVersion`, new instructions or a new `AI_RESPONSE_JSON_SCHEMA` need new fixtures: write them with
`writeFixture(dir, request, fixture)`, or record them again. A test pins the hash of one known request, so a change in
the way the hash is made cannot go unnoticed.

## The rules every fulfiller follows

- An answer is `{ response, model }` with a valid `response`, or `"not_analyzed"` (only for "nobody was asked").
- A refusal or an answer that is not valid is **thrown** (`AI_BAD_RESPONSE`), never turned into `"not_analyzed"`: it fails
  only that step, and the kernel goes on with the others.
- `AI_AUTH`, `AI_BAD_RESPONSE` and `CANCELLED` are never tried again, whatever flag the provider sets.
- A signal that aborts gives `CANCELLED`, also while it waits for a provider that ignores the signal, and no listener or
  timer is left behind.
- The text of an error from a stranger (the SDK, a queue) never reaches the user: it becomes `INTERNAL` with a fixed message.

## Working on it

```
pnpm --filter @flawdot/ai-provider test        # no network, no key, no cost
pnpm --filter @flawdot/ai-provider record-fixtures   # MANUAL, spends API money; a dry run until Task 35
```

A1: the package may import only `@flawdot/core-model` (and, in the tests, `@flawdot/test-support`). `.oxlintrc.json` also
forbids `@anthropic-ai/*` in it for now. N1: `test/no-network.test.ts` replaces `fetch`, scans the source for a host, a
key, the SDK or any way to open a connection, and checks that `dependencies` is only `core-model`.
