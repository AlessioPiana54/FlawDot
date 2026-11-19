import { FlawDotError, type SecretStore } from "@flawdot/core-model";

/** An API key is about a hundred characters, so a longer one is a mistake (and some stores have a limit of their own). */
const API_KEY_MAX_LENGTH = 1024;

/**
 * The key lives in a variable of the closure, not in a property: the object has nothing that a log, a dump or
 * `JSON.stringify` could print. The messages of the errors say what is wrong with the key, and never repeat it.
 */
export function createInMemorySecretStore(): SecretStore {
  let apiKey: string | null = null;
  return {
    getApiKey: async () => apiKey,
    setApiKey: async (key) => {
      if (key.trim() === "") {
        throw new FlawDotError("INVALID_INPUT", "The API key is empty");
      }
      if (key.length > API_KEY_MAX_LENGTH) {
        throw new FlawDotError(
          "INVALID_INPUT",
          `The API key is longer than ${String(API_KEY_MAX_LENGTH)} characters`,
        );
      }
      apiKey = key;
    },
    clearApiKey: async () => {
      apiKey = null;
    },
  };
}
