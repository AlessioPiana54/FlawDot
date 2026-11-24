// Public API of @flawdot/mcp-server: only what is exported here is contract.
export { createMcpServer, type McpServerHandle } from "./server.js";
export type { ImageReader, McpServerDeps, ToolImage } from "./ports.js";
export type { Log } from "./result.js";
