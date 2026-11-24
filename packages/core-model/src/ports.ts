// Ports towards the outside world (dependency inversion): the kernel and the plugins use them, adapters implement
// them. They stay whole: each module that uses one narrows it with `Pick<>` to what it needs. The contract tests
// that every adapter of a port must pass are in `@flawdot/test-support`; each adapter runs them in its own tests.
import type { AiAnalysisRequest } from "./ai-request.js";
import type { Capture, Project, Run } from "./domain.js";
import type { Finding, FindingState } from "./finding.js";
import type { FindingId, ProjectId, RunId } from "./ids.js";
import type { AiAnalysisResponse } from "./schemas.js";
import type { Settings } from "./settings.js";

/**
 * What core-model needs from an `AbortSignal`. core-model is built without DOM or Node types, so it cannot name
 * the real one; the real one has this shape, so the kernel passes its signals as they are. The methods of the
 * interfaces that take it are written as methods, so an adapter may still declare its parameter as `AbortSignal`.
 */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** Time comes in through this port so tests can freeze it. */
export interface Clock {
  now(): Date;
}

/** ULIDs, sortable by creation time. A fake generator in tests makes every id predictable. */
export interface IdGenerator {
  runId(): RunId;
  findingId(): FindingId;
}

/** One project per site (a host name, or `localhost-<port>`). */
export interface ProjectRepository {
  getOrCreate(origin: string): Promise<Project>;
  list(): Promise<Project[]>;
}

export interface RunRepository {
  save(run: Run): Promise<void>;
  get(id: RunId): Promise<Run>;
  /**
   * The newest run of the project that is `completed`, optionally older than `before`. The comparison with the
   * previous analysis uses only completed runs, so the name says it.
   */
  latestCompleted(projectId: ProjectId, before?: RunId): Promise<Run | null>;
  list(projectId: ProjectId): Promise<Run[]>;
}

export interface FindingRepository {
  /** Saves findings; one that is already saved (same id) is replaced, which is how new circle numbers are stored. */
  saveAll(findings: readonly Finding[]): Promise<void>;
  byRun(id: RunId): Promise<Finding[]>;
  /** "Ignore" is tied to the project and the fingerprint, not to one finding, so it holds in later runs too. */
  setState(projectId: ProjectId, fingerprint: string, state: FindingState): Promise<void>;
  /** Keyed by fingerprint. */
  states(projectId: ProjectId): Promise<ReadonlyMap<string, FindingState>>;
}

export interface SettingsRepository {
  get(): Promise<Settings>;
  /** Replaces the fields in `patch` (a field is replaced as a whole) and gives back the settings now in force. */
  update(patch: Partial<Settings>): Promise<Settings>;
}

/** The API key of the user. It never leaves this port towards logs or errors. */
export interface SecretStore {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
}

/** Draws the numbered circles on the screenshot. Findings that are ignored or have no element get no circle. */
export interface Annotator {
  annotate(capture: Capture, findings: readonly Finding[]): Promise<{ path: string }>;
}

/**
 * Where files go. It only hands out paths: whoever makes a file (Playwright, sharp) writes it there. It is a port
 * of core-model, and not of the storage module, because capture, annotation, exporters and the web server all use it.
 *
 * `name` is a base name with no extension: the store adds the one of the kind ("png", "marked.png", "annotated.png",
 * "tile.png"). So the screenshot, the marked screenshot and the annotated one of a page share one `name`, and a caller
 * never has to know how a store spells an extension. A tile has the name of its page with the number of the tile
 * added ("<name>__t3"), so the tiles of a page are told apart by the name and not by a second argument.
 *
 * The exception is `export`: only the exporter knows the format, so its `name` carries the extension ("report.pdf").
 * A store makes the folder of the path it hands out and refuses a name that could lead out of it, by throwing a
 * `FlawDotError` with the code `INVALID_INPUT`.
 */
export interface ArtifactStore {
  pathFor(
    runId: RunId,
    kind: "screenshot" | "marked" | "annotated" | "export" | "tile",
    name: string,
  ): string;
  /** Where the saved login session of a project lives. */
  sessionPath(projectId: ProjectId): string;
  clearSession(projectId: ProjectId): Promise<void>;
}

/**
 * How the MCP mode asks Claude Code to analyze a tile: the request waits in a queue until Claude Code takes it,
 * and the promise settles when `record_findings` brings the answer. Only this side is a port, because it is the
 * only side that `McpFulfiller` needs; taking requests and recording answers belong to the MCP server itself.
 */
export interface McpRequestQueue {
  submit(request: AiAnalysisRequest, signal: AbortSignalLike): Promise<AiAnalysisResponse>;
}
