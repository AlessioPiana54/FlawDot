import { DEFAULT_SETTINGS, defaultSettings, type Settings } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../errors.js";
import { useFixture, withSecondInstance, type RepositoriesFactory } from "../harness.js";

/**
 * What every `SettingsRepository` must do. There is one set of settings for the whole app. A field that is
 * in the patch is replaced as a whole (there is no merge inside `weights` or `captureLimits`), and a patch that
 * would make the settings invalid changes nothing.
 */
export function runSettingsRepositoryContract(factory: RepositoriesFactory<"settings">): void {
  describe("SettingsRepository contract", () => {
    const current = useFixture(factory);
    const settings = () => current().fixture.subject.settings;

    it("gives the default settings until the user changes something", async () => {
      expect(await settings().get()).toEqual(defaultSettings());
    });

    it("gives a copy of the defaults that nobody else can change", async () => {
      const first = await settings().get();
      (first.viewports as string[]).push("tablet");
      first.captureLimits.maxElements = 999;

      expect(await settings().get()).toEqual(defaultSettings());
      expect(DEFAULT_SETTINGS).toEqual(defaultSettings());
    });

    it("gives a copy of the settings that were changed, too", async () => {
      await settings().update({ aiTier: "economy" });
      const read = await settings().get();
      (read.viewports as string[]).push("tablet");
      read.captureLimits.maxElements = 999;

      const again = await settings().get();

      expect(again.viewports).toEqual(["desktop", "mobile"]);
      expect(again.captureLimits.maxElements).toBe(300);
    });

    it("changes the fields of the patch and gives back the settings now in force", async () => {
      const result = await settings().update({ aiTier: "economy", defaultLanguage: "it" });

      expect(result).toEqual({ ...defaultSettings(), aiTier: "economy", defaultLanguage: "it" });
      expect(await settings().get()).toEqual(result);
    });

    it("keeps what an earlier update changed when a later one changes something else", async () => {
      await settings().update({ aiTier: "economy" });

      const result = await settings().update({ defaultLanguage: "it" });

      expect(result.aiTier).toBe("economy");
      expect(result.defaultLanguage).toBe("it");
    });

    it("replaces a field as a whole", async () => {
      const result = await settings().update({ viewports: ["tablet"] });

      expect(result.viewports).toEqual(["tablet"]);
    });

    it("replaces the weights as a whole", async () => {
      const weights = { ui: 1, ux: 0, accessibility: 0, conversion: 0 };

      expect((await settings().update({ weights })).weights).toEqual(weights);
    });

    it("changes nothing for an empty patch, or for a field that is undefined", async () => {
      await settings().update({ aiTier: "economy" });

      await settings().update({});
      // The type forbids `undefined` here, but an object that comes from JSON or from JavaScript can have it.
      await settings().update({ aiTier: undefined } as unknown as Partial<Settings>);

      expect((await settings().get()).aiTier).toBe("economy");
    });

    it.each([
      [
        "a number of elements under the lowest one",
        { captureLimits: { maxElements: 19, maxHeight: 15000 } },
      ],
      [
        "a number of elements over the highest one",
        { captureLimits: { maxElements: 1001, maxHeight: 15000 } },
      ],
      [
        "a height of the page over the highest one",
        { captureLimits: { maxElements: 300, maxHeight: 50001 } },
      ],
      ["a capture limit that is not whole", { captureLimits: { maxElements: 300 } }],
      ["a viewport twice", { viewports: ["mobile", "mobile"] }],
      ["no viewport at all", { viewports: [] }],
      ["an AI tier that does not exist", { aiTier: "cheap" }],
      ["a language that does not exist", { defaultLanguage: "fr" }],
      [
        "weights that do not add up to 1",
        { weights: { ui: 1, ux: 1, accessibility: 1, conversion: 1 } },
      ],
      ["a setting that does not exist", { theme: "dark" }],
    ])("rejects %s, and changes nothing", async (_label, patch) => {
      await settings().update({ aiTier: "economy" });
      const before = await settings().get();

      const error = await rejectionOf(() => settings().update(patch as Partial<Settings>));

      expect(error.code).toBe("INVALID_INPUT");
      expect(await settings().get()).toEqual(before);
    });

    it("keeps no hold on the patch it was given, or on the settings it gave back", async () => {
      const patch = { viewports: ["tablet" as const] };
      const result = await settings().update(patch);
      patch.viewports.push("mobile" as never);
      (result.viewports as string[]).push("desktop");

      expect((await settings().get()).viewports).toEqual(["tablet"]);
    });

    it.each([
      ["a __proto__ key", '{"__proto__": {"polluted": true}}'],
      ["a constructor key", '{"constructor": {"prototype": {"polluted": true}}}'],
    ])(
      "rejects a patch with %s, and leaves the prototype of every object alone",
      async (_label, json) => {
        const patch = JSON.parse(json) as Partial<Settings>; // JSON.parse makes "__proto__" a key of its own

        const error = await rejectionOf(() => settings().update(patch));

        expect(error.code).toBe("INVALID_INPUT");
        expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
        expect(await settings().get()).toEqual(defaultSettings());
      },
    );

    it("does not share settings between two instances", async () => {
      await settings().update({ aiTier: "economy" });

      await withSecondInstance(factory, current().clock, async (second) => {
        expect((await second.subject.settings.get()).aiTier).toBe("accurate");
      });
    });
  });
}
