import { describe, expect, it } from "vitest";
import {
  type Capture,
  DEFAULT_SETTINGS,
  defaultSettings,
  type AbortSignalLike,
  type AiAnalysisRequest,
  type AiFulfiller,
  type AiProvider,
  type AnalyzerPlugin,
  type Annotator,
  type ArtifactStore,
  type CaptureContext,
  type DiscoveryResult,
  type FindingRepository,
  type InputPlugin,
  type LivePage,
  type McpRequestQueue,
  type ProjectRepository,
  type RuleAnalyzer,
  type RunRepository,
  type SecretStore,
  type SettingsRepository,
} from "../src/index.js";
import { capture, pageTarget, projectId, run, runId } from "./fixtures.js";

// These interfaces have no code of their own, so these tests are about the TYPES: each fake below is written with
// `satisfies`, so `tsc` (part of check:fast) fails if an interface and its use drift apart. The runtime
// assertions only make sure that a fake can really be called the way the kernel will call it.

/** A signal that nobody aborts, written without any platform type. */
const idle: AbortSignalLike = {
  aborted: false,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

const limits = DEFAULT_SETTINGS.captureLimits;
const context: CaptureContext = { runId, projectId, limits };

const request: AiAnalysisRequest = {
  requestId: "req-1",
  runId,
  pageUrl: pageTarget.url,
  viewport: "desktop",
  tile: 0,
  promptVersion: "v1",
  analyzer: "conversion",
  language: "en",
  instructions: "Find conversion problems.",
  image: { path: "shots/tile-0.png", mediaType: "image/png" },
  elements: [],
  responseSchema: {},
};

const discovery: DiscoveryResult = {
  origin: "http://localhost:3000",
  totalFound: 1,
  groups: [{ templateKey: "/", size: 1, representative: "http://localhost:3000/", samples: [] }],
  options: [
    {
      id: "single",
      isRecommended: true,
      pages: [pageTarget],
      captures: 2,
      minutes: 1,
      costUsd: null,
    },
  ],
};

describe("an input plugin is built from two halves, one per module", () => {
  // The capture module implements only `capture`, the discovery module only `discover`; the composition root joins them.
  const capturer = {
    id: "url",
    capture: async () => capture,
  } satisfies Pick<InputPlugin, "capture"> & { id: "url" };

  const discoverer = {
    id: "url",
    discover: async () => discovery,
  } satisfies Pick<InputPlugin, "discover"> & { id: "url" };

  const input: InputPlugin = { ...capturer, ...discoverer };

  it("can be called as the kernel will call it", async () => {
    const opts = {
      coverage: "page",
      viewports: ["desktop"],
      ai: { kind: "none" },
      limit: 20,
    } as const;
    expect(await input.discover("http://localhost:3000", opts, idle)).toEqual(discovery);
    const live: LivePage = { page: {}, boxOf: async () => null };
    // The callback gets the capture too: the rule analyzers need its elements to place a selector on a mark.
    let received: [LivePage, Capture] | undefined;
    const taken = await input.capture(
      pageTarget,
      capture.viewport,
      context,
      idle,
      async (page, taking) => {
        received = [page, taking];
      },
    );
    expect(taken).toBe(capture);
    expect(received).toBeUndefined(); // this stub never calls it
    expect(await live.boxOf("#x")).toBeNull();
  });

  it("does not need the optional live-page callback", async () => {
    expect(await input.capture(pageTarget, capture.viewport, context, idle)).toBe(capture);
  });
});

describe("an analyzer is either a rule analyzer or an AI analyzer", () => {
  const rules = {
    kind: "rule",
    id: "accessibility-wcag",
    category: "accessibility",
    analyze: async () => [],
  } satisfies RuleAnalyzer;

  const ai = {
    kind: "ai",
    id: "conversion",
    category: "conversion",
    buildRequests: () => [request],
  } satisfies AnalyzerPlugin;

  // The switch has no default: if a third kind is added to the union, this stops compiling.
  const describeKind = (plugin: AnalyzerPlugin): string => {
    switch (plugin.kind) {
      case "rule":
        return `rules:${plugin.id}`;
      case "ai":
        return `ai:${plugin.id}`;
    }
  };

  it("can be told apart by its kind", () => {
    expect(describeKind(rules)).toBe("rules:accessibility-wcag");
    expect(describeKind(ai)).toBe("ai:conversion");
  });

  it("builds one request per tile; the answers are read with the shared `toDrafts`", () => {
    expect(ai.buildRequests()).toEqual([request]);
  });
});

describe("who answers an AI request", () => {
  const answer = { findings: [] };

  const provider = {
    mode: "byok",
    fulfill: async () => ({ response: answer, model: "claude-sonnet-5-5" }),
  } satisfies AiFulfiller;

  const none = { mode: "none", fulfill: async () => "not_analyzed" } satisfies AiFulfiller;

  const mcp = {
    mode: "subscription",
    fulfill: async () => ({ response: answer, model: "claude-code" }),
  } satisfies AiFulfiller;

  it("returns the answer together with the model that wrote it, or says the category was not analyzed", async () => {
    expect(await provider.fulfill()).toEqual({ response: answer, model: "claude-sonnet-5-5" });
    expect(await mcp.fulfill()).toEqual({ response: answer, model: "claude-code" });
    expect(await none.fulfill()).toBe("not_analyzed");
  });

  it("has a provider that estimates for a tier and answers with its model", async () => {
    const fake = {
      id: "fake",
      estimate: async () => ({ inputTokens: 10, outputTokens: 5, usd: 0 }),
      run: async () => ({ response: answer, model: "claude-haiku-5-5" }),
    } satisfies AiProvider;
    expect(await fake.estimate()).toEqual({ inputTokens: 10, outputTokens: 5, usd: 0 });
    expect(await fake.run()).toEqual({ response: answer, model: "claude-haiku-5-5" });
  });

  it("has a queue that takes a request and gives back the answer Claude Code recorded for it", async () => {
    const queue = { submit: async () => answer } satisfies McpRequestQueue;
    expect(await queue.submit()).toBe(answer);
  });
});

describe("the ports towards the infrastructure", () => {
  it("lets the repositories be written with the methods the kernel needs", async () => {
    const projects = {
      getOrCreate: async () => ({
        id: projectId,
        origin: "http://localhost:3000",
        createdAt: run.startedAt,
      }),
      list: async () => [],
    } satisfies ProjectRepository;
    const runs = {
      save: async () => undefined,
      get: async () => run,
      latestCompleted: async () => null,
      list: async () => [run],
    } satisfies RunRepository;
    const findings = {
      saveAll: async () => undefined,
      byRun: async () => [],
      setState: async () => undefined,
      states: async () => new Map(),
    } satisfies FindingRepository;
    const settings = {
      get: async () => defaultSettings(),
      update: async () => defaultSettings(),
    } satisfies SettingsRepository;

    expect((await projects.getOrCreate()).origin).toBe("http://localhost:3000");
    expect(await runs.latestCompleted()).toBeNull();
    expect(await findings.states()).toEqual(new Map());
    expect(await settings.get()).toEqual(DEFAULT_SETTINGS);
    expect(await runs.get()).toBe(run);
  });

  it("lets the secret store, the annotator and the artifact store be written as small ports", async () => {
    const secrets = {
      getApiKey: async () => null,
      setApiKey: async () => undefined,
      clearApiKey: async () => undefined,
    } satisfies SecretStore;
    const annotator = {
      annotate: async () => ({ path: "shots/annotated.png" }),
    } satisfies Annotator;
    const artifacts = {
      pathFor: () => "shots/a.png",
      sessionPath: () => "sessions/x.json",
      clearSession: async () => undefined,
    } satisfies ArtifactStore;

    expect(await secrets.getApiKey()).toBeNull();
    expect(await annotator.annotate()).toEqual({ path: "shots/annotated.png" });
    expect(artifacts.pathFor()).toBe("shots/a.png");
  });
});

describe("the signal type that core-model uses in place of AbortSignal", () => {
  // core-model is built without DOM or Node types, so it cannot name AbortSignal. This checks that the real one
  // that the kernel passes at runtime has the shape the interfaces ask for.
  const AbortControllerClass = (
    globalThis as unknown as {
      AbortController: new () => { signal: AbortSignalLike; abort(): void };
    }
  ).AbortController;

  it("is satisfied by a real AbortSignal", () => {
    const controller = new AbortControllerClass();
    let fired = 0;
    const onAbort = () => {
      fired += 1;
    };
    controller.signal.addEventListener("abort", onAbort, { once: true });
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
    expect(fired).toBe(1);
    controller.signal.removeEventListener("abort", onAbort);
  });

  it("can be implemented by a plain object, which is what the tests of the other modules will do", () => {
    expect(idle.aborted).toBe(false);
    expect(() => idle.addEventListener("abort", () => undefined)).not.toThrow();
  });
});
