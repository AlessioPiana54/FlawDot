import {
  runFindingRepositoryContract,
  runProjectRepositoryContract,
  runRunRepositoryContract,
  runSettingsRepositoryContract,
} from "@flawdot/test-support";
import { createInMemoryStorage } from "../src/index.js";

const create = (clock: Parameters<typeof createInMemoryStorage>[0]["clock"]) => ({
  subject: createInMemoryStorage({ clock }),
});

runProjectRepositoryContract(create);
runRunRepositoryContract(create);
runFindingRepositoryContract(create);
runSettingsRepositoryContract(create);
