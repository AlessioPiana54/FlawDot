import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../errors.js";
import { useFixture, withSecondInstance, type SecretStoreFactory } from "../harness.js";

/**
 * The longest key a store accepts: an API key is about a hundred characters, so a longer one is a mistake. It is
 * written here and in each adapter on purpose: the suite is the oracle, and an adapter that drifts fails it.
 */
const API_KEY_MAX_LENGTH = 1024;

// A value that does not look like an API key on purpose: the floor guard looks for the format of an Anthropic key, and gitleaks (S1)
// reports a constant that is named like a key and holds a varied string. A word repeated has too little entropy for that.
const CANARY = "CANARY-CANARY-CANARY";

/**
 * What every `SecretStore` must do. The key is a secret: it never leaves the store towards a log, an error or
 * a dump of the object (the port says so). The stores that keep it on disk (keyring, file) add their own checks.
 */
export function runSecretStoreContract(factory: SecretStoreFactory): void {
  describe("SecretStore contract", () => {
    const current = useFixture(factory);
    const store = () => current().fixture.subject;

    it("has no key at the start", async () => {
      expect(await store().getApiKey()).toBeNull();
    });

    it("gives back the key that was set, exactly as it was given", async () => {
      const key = `${CANARY} `; // the space at the end is part of the key: trimming is the job of whoever reads it

      await store().setApiKey(key);

      expect(await store().getApiKey()).toBe(key);
    });

    it.each([
      ["a line break", `${CANARY}\n`],
      ["a Windows line break in the middle", `${CANARY}\r\n${CANARY}`],
      ["letters that are not ASCII", `${CANARY}-chiave-é-日本語-🔑`],
      ["quotes and backslashes", `${CANARY}-"quoted"-'single'-\\back\\slash-{"json":1}`],
      ["a null character", `${CANARY}\0${CANARY}`],
    ])("gives back a key with %s exactly as it was set", async (_label, key) => {
      await store().setApiKey(key);

      expect(await store().getApiKey()).toBe(key);
    });

    it("replaces the key when another is set", async () => {
      await store().setApiKey(CANARY);

      await store().setApiKey(`${CANARY}-new`);

      expect(await store().getApiKey()).toBe(`${CANARY}-new`);
    });

    it("forgets the key that is cleared", async () => {
      await store().setApiKey(CANARY);

      await store().clearApiKey();

      expect(await store().getApiKey()).toBeNull();
    });

    it("clears without an error when there is no key", async () => {
      await store().clearApiKey();
      await store().clearApiKey();

      expect(await store().getApiKey()).toBeNull();
    });

    it.each([
      ["an empty key", ""],
      ["a key made only of spaces and line breaks", "  \n\t "],
      [
        `a key of more than ${String(API_KEY_MAX_LENGTH)} characters`,
        "k".repeat(API_KEY_MAX_LENGTH + 1),
      ],
    ])("rejects %s, and keeps the key it had", async (_label, key) => {
      await store().setApiKey(CANARY);

      const error = await rejectionOf(() => store().setApiKey(key));

      expect(error.code).toBe("INVALID_INPUT");
      expect(await store().getApiKey()).toBe(CANARY);
    });

    it("accepts a key of the longest length", async () => {
      const key = "k".repeat(API_KEY_MAX_LENGTH);

      await store().setApiKey(key);

      expect(await store().getApiKey()).toBe(key);
    });

    it("never puts the key in the error that rejects it, in any form an error can be shown", async () => {
      const tooLong = `${CANARY}${"x".repeat(API_KEY_MAX_LENGTH)}`;
      await store().setApiKey(`${CANARY}-stored`);

      const error = await rejectionOf(() => store().setApiKey(tooLong));

      const shown = [
        error.message,
        error.stack ?? "",
        String(error),
        inspect(error, { depth: 10, showHidden: true }),
        JSON.stringify(error.toShape()),
        JSON.stringify(error, Object.getOwnPropertyNames(error)),
      ];
      for (const text of shown) {
        expect(text).not.toContain("CANARY");
      }
    });

    it("does not show the key when the store is printed or turned into JSON", async () => {
      await store().setApiKey(CANARY);

      expect(JSON.stringify(store())).not.toContain("CANARY");
      expect(inspect(store(), { depth: 10, showHidden: true })).not.toContain("CANARY");
    });

    it("does not share the key between two instances", async () => {
      await store().setApiKey(CANARY);

      await withSecondInstance(factory, current().clock, async (second) => {
        expect(await second.subject.getApiKey()).toBeNull();
      });
    });
  });
}
