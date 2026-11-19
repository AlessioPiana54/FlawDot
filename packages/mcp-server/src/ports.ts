import type { AiMode, SettingsRepository } from "@flawdot/core-model";
import type { FlawDot } from "@flawdot/kernel";
import type { Log } from "./result.js";

/** A picture ready to go in a result: PNG bytes as base64. */
export interface ToolImage {
  readonly data: string;
  readonly mimeType: "image/png";
}

/**
 * Reads the picture at a path and gives it in a size that fits in a message. The server does not touch the file system
 * or an image library: whoever builds it gives this.
 */
export type ImageReader = (path: string) => Promise<ToolImage>;

export interface McpServerDeps {
  /** Only what the tools use of the kernel, so a test gives two functions and no more. */
  readonly flawdot: Pick<FlawDot, "analyze" | "report">;
  /** Where the viewports and the language come from when a call does not say. */
  readonly settings: Pick<SettingsRepository, "get">;
  readonly images: ImageReader;
  /**
   * Who does the AI part of an analysis. The one that builds the server knows, because it is the one that chooses the
   * fulfiller: it is not for a tool to say.
   */
  readonly ai: AiMode;
  readonly version: string;
  /** Where the detail of an unexpected error goes. The cli gives stderr. The server never writes to stdout. */
  readonly log: Log;
  /** How long `flawdot_next` waits for the end of a run before it tells how far it is. Default 20 s. */
  readonly nextWaitMs?: number;
}
