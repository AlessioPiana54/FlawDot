import { describe, expect, it } from "vitest";
import { parseAxeResults } from "../src/axe-results.js";
import { evidenceFor } from "../src/evidence.js";
import { node } from "./support/builders.js";
import { savedAxeResult } from "./support/fixtures.js";

const withCheck = (id: string, data: unknown) => node("#a", { checks: [{ id, data }] });

describe("evidenceFor in Italian", () => {
  const saved = parseAxeResults(savedAxeResult("violations")).violations;
  const nodeOf = (ruleId: string) => {
    const found = saved.find((entry) => entry.id === ruleId)?.nodes[0];
    if (found === undefined) throw new Error(`the saved result has no ${ruleId}`);
    return found;
  };

  it("writes the contrast with a decimal comma, and leaves the colours as they are", () => {
    expect(evidenceFor("color-contrast", nodeOf("color-contrast"), "it")).toBe(
      "#c9c9c9 su #f7f5ff, 1,53:1 (richiesto 4,5:1)",
    );
  });

  it("says that the element has no accessible name, and which one", () => {
    expect(evidenceFor("button-name", nodeOf("button-name"), "it")).toBe(
      "Nessun nome accessibile su <button>",
    );
    expect(evidenceFor("button-name", { ...nodeOf("button-name"), html: "" }, "it")).toBe(
      "Nessun nome accessibile",
    );
  });
});

describe("evidenceFor: the size of a target that is too small", () => {
  const small = withCheck("target-size", { minSize: 24, width: 18, height: 20.5 });

  it("gives the size that axe measured and the size that is needed", () => {
    expect(evidenceFor("target-size", small, "en")).toBe("18x20.5 px (needs 24x24 px)");
    expect(evidenceFor("target-size", small, "it")).toBe("18x20,5 px (richiesto 24x24 px)");
  });

  it("writes a decimal comma in both sizes in Italian, not only in the first", () => {
    const both = withCheck("target-size", { minSize: 24, width: 18.5, height: 20.5 });
    expect(evidenceFor("target-size", both, "it")).toBe("18,5x20,5 px (richiesto 24x24 px)");
  });

  it.each([
    ["no data", undefined],
    ["the answer of axe for an obscured target, which has no size", { messageKey: "obscured" }],
    ["a missing width", { minSize: 24, height: 20 }],
    ["a size that is not a number", { minSize: 24, width: "18", height: 20 }],
    ["a size that is not finite", { minSize: 24, width: Number.NaN, height: 20 }],
    ["a size that is negative", { minSize: 24, width: -1, height: 20 }],
    ["a minimum of zero", { minSize: 0, width: 18, height: 20 }],
  ])("gives nothing for %s", (_what, data) => {
    expect(evidenceFor("target-size", withCheck("target-size", data), "en")).toBeNull();
  });
});

describe("evidenceFor: a language code that is not valid", () => {
  it.each(["html-lang-valid", "valid-lang"])(
    "names the code that the page wrote, for %s",
    (ruleId) => {
      const found = withCheck("valid-lang", ['lang="xx"']);
      expect(evidenceFor(ruleId, found, "en")).toBe('Invalid language code: lang="xx"');
      expect(evidenceFor(ruleId, found, "it")).toBe('Codice lingua non valido: lang="xx"');
    },
  );

  it("accepts the attribute xml:lang, and takes the first value that is safe", () => {
    const found = withCheck("valid-lang", ['lang="<b>"', 'xml:lang="e-n"']);
    expect(evidenceFor("valid-lang", found, "en")).toBe('Invalid language code: xml:lang="e-n"');
  });

  it.each([
    ["no data", undefined],
    ["data that is not a list", 'lang="xx"'],
    ["a value with markup", ['lang="x<script>"']],
    ["a value that is too long", [`lang="${"a".repeat(36)}"`]],
    ["an entry that is not text", [3]],
    ["an attribute that is not a language", ['title="xx"']],
  ])("gives nothing for %s", (_what, data) => {
    expect(evidenceFor("valid-lang", withCheck("valid-lang", data), "en")).toBeNull();
  });
});

describe("evidenceFor: a role that does not exist", () => {
  it("names the roles, at most three, and counts the rest", () => {
    const found = withCheck("invalidrole", ["foo", "Bar", "baz", "qux", "quux"]);
    expect(evidenceFor("aria-roles", found, "en")).toBe("Unknown role: foo, Bar, baz, +2");
    expect(evidenceFor("aria-roles", found, "it")).toBe("Ruolo sconosciuto: foo, Bar, baz, +2");
  });

  it("skips a role with a character that is not allowed, and gives nothing when none is left", () => {
    expect(evidenceFor("aria-roles", withCheck("invalidrole", ["a b", "ok"]), "en")).toBe(
      "Unknown role: ok",
    );
    expect(evidenceFor("aria-roles", withCheck("invalidrole", ["<b>", "x y"]), "en")).toBeNull();
    expect(evidenceFor("aria-roles", withCheck("invalidrole", "foo"), "en")).toBeNull();
    expect(evidenceFor("aria-roles", withCheck("invalidrole", []), "en")).toBeNull();
  });

  it("skips a role that is longer than any real one", () => {
    const edge = `a${"b".repeat(39)}`;
    expect(evidenceFor("aria-roles", withCheck("invalidrole", [edge]), "en")).toBe(
      `Unknown role: ${edge}`,
    );
    expect(evidenceFor("aria-roles", withCheck("invalidrole", [`${edge}b`]), "en")).toBeNull();
  });
});

describe("evidenceFor: an ARIA attribute that does not exist", () => {
  it("names the attributes", () => {
    const found = withCheck("aria-valid-attr", ["aria-foo", "aria-bar-baz"]);
    expect(evidenceFor("aria-valid-attr", found, "en")).toBe(
      "Unknown attribute: aria-foo, aria-bar-baz",
    );
    expect(evidenceFor("aria-valid-attr", found, "it")).toBe(
      "Attributo sconosciuto: aria-foo, aria-bar-baz",
    );
  });

  it("gives nothing for what is not the name of an ARIA attribute, or for no data", () => {
    const wrong = withCheck("aria-valid-attr", ["x=1", "aria-a b"]);
    expect(evidenceFor("aria-valid-attr", wrong, "en")).toBeNull();
    expect(
      evidenceFor("aria-valid-attr", withCheck("aria-valid-attr", undefined), "en"),
    ).toBeNull();
  });
});

describe("evidenceFor: an ARIA attribute that this element may not have", () => {
  const found = withCheck("aria-allowed-attr", {
    messageKey: "plural",
    values: ['aria-checked="true"', 'aria-pressed="javascript:steal()"'],
  });

  it("names the attributes and never the values that the page wrote", () => {
    expect(evidenceFor("aria-allowed-attr", found, "en")).toBe(
      "Not allowed on this element: aria-checked, aria-pressed",
    );
    expect(evidenceFor("aria-allowed-attr", found, "it")).toBe(
      "Non consentito su questo elemento: aria-checked, aria-pressed",
    );
  });

  it.each([
    [
      "a value that is case sensitive, which is another problem",
      {
        messageKey: "caseSensitive",
        values: ['aria-live="Polite"'],
      },
    ],
    ["values that are not a list", { values: "x" }],
    ["a value that is not an ARIA attribute", { values: ["role=x"] }],
    ["no data", undefined],
  ])("gives nothing for %s", (_what, data) => {
    expect(evidenceFor("aria-allowed-attr", withCheck("aria-allowed-attr", data), "en")).toBeNull();
  });
});
