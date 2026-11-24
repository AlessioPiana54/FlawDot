// Shared test helpers and the contract suites that every adapter of a port must pass (Liskov, ADR-0001).
// Only tests import this package. `.oxlintrc.json` forbids it in the `src` of storage, kernel and ai-provider; every other package lists it,
// if at all, as a dev dependency, so it stays out of what is shipped.
export * from "./fixtures.js";
export * from "./harness.js";
export * from "./errors.js";
export * from "./contracts/projects.js";
export * from "./contracts/runs.js";
export * from "./contracts/findings.js";
export * from "./contracts/settings.js";
export * from "./contracts/secret-store.js";
export * from "./contracts/artifact-store.js";
export * from "./contracts/ai-fulfiller.js";
export * from "./contracts/ai-provider.js";
