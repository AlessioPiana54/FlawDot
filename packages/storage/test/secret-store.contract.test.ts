import { runSecretStoreContract } from "@flawdot/test-support";
import { createInMemorySecretStore } from "../src/index.js";

runSecretStoreContract(() => ({ subject: createInMemorySecretStore() }));
