// The ways an AI request gets answered, and the fake provider that lets every test run with no key and no cost (N1).
// The real provider (Task 35) will live here too; nothing in this package reaches the network until then.
export { createFakeProvider, type FakeProviderOptions } from "./fake-provider.js";
export { createProviderFulfiller, type ProviderFulfillerOptions } from "./provider-fulfiller.js";
export {
  createMcpFulfiller,
  DEFAULT_MCP_TIMEOUT_MS,
  type McpFulfillerOptions,
} from "./mcp-fulfiller.js";
export { fixtureKey } from "./fixture-key.js";
export { writeFixture, type FakeFixture, type FakeStep } from "./fixture-file.js";
export {
  RecordInterrupted,
  recordFixtures,
  type RecordOptions,
  type RecordResult,
} from "./record.js";
