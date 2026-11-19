import { describe, expect, it } from "vitest";
import { FlawDotError } from "@flawdot/core-model";
import { createRuleCatalog, emptyCatalog } from "../src/catalog.js";

const text = (name: string) => ({
  title: `Title ${name}`,
  explanation: `Why ${name}`,
  fix: `Fix ${name}`,
});

const axeItalian = {
  lang: "it",
  rules: {
    "color-contrast": { help: "Axe titolo contrasto", description: "Axe descrizione contrasto" },
    accesskeys: { help: "Axe titolo accesskey", description: "Axe descrizione accesskey" },
  },
  checks: {},
};

const sources = () => ({
  own: { en: { "color-contrast": text("en") }, it: { "color-contrast": text("it") } },
  axeItalian,
});

describe("emptyCatalog", () => {
  it("has no text for any rule", () => {
    expect(emptyCatalog.lookup("color-contrast", "en")).toBeUndefined();
  });
});

describe("createRuleCatalog: the texts that FlawDot wrote", () => {
  it("gives the text of the rule in the language asked for", () => {
    const catalog = createRuleCatalog(sources());
    expect(catalog.lookup("color-contrast", "en")).toEqual(text("en"));
    expect(catalog.lookup("color-contrast", "it")).toEqual(text("it"));
  });

  it("gives nothing for a rule that is not in the catalog, so the finding uses the text of axe", () => {
    const catalog = createRuleCatalog(sources());
    expect(catalog.lookup("some-other-rule", "en")).toBeUndefined();
    expect(catalog.lookup("some-other-rule", "it")).toBeUndefined();
  });

  it("does not take a name from the prototype of an object for a rule", () => {
    const catalog = createRuleCatalog(sources());
    for (const name of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(catalog.lookup(name, "en")).toBeUndefined();
      expect(catalog.lookup(name, "it")).toBeUndefined();
    }
  });
});

describe("createRuleCatalog: the Italian of axe for a rule that FlawDot has no text for", () => {
  it("uses the help of axe as the title and the fix, and its description as the explanation", () => {
    const catalog = createRuleCatalog(sources());
    expect(catalog.lookup("accesskeys", "it")).toEqual({
      title: "Axe titolo accesskey",
      explanation: "Axe descrizione accesskey",
      fix: "Axe titolo accesskey",
    });
  });

  it("prefers the text of FlawDot to the Italian of axe", () => {
    expect(createRuleCatalog(sources()).lookup("color-contrast", "it")).toEqual(text("it"));
  });

  it("is only for Italian: in English the finding keeps the text of axe, which already ran in English", () => {
    expect(createRuleCatalog(sources()).lookup("accesskeys", "en")).toBeUndefined();
  });

  it("gives nothing for a rule that axe has no Italian text for", () => {
    expect(createRuleCatalog(sources()).lookup("aria-tab-name", "it")).toBeUndefined();
  });

  it("skips what is not usable instead of failing: it is data of a dependency, not of FlawDot", () => {
    const catalog = createRuleCatalog({
      ...sources(),
      axeItalian: {
        rules: {
          "no-help": { description: "d" },
          "blank-help": { help: "  ", description: "d" },
          "blank-description": { help: "h", description: "" },
          "not-text": { help: 3, description: "d" },
          "not-an-object": "x",
          "Bad Id": { help: "h", description: "d" },
          fine: { help: "h", description: "d" },
          __proto__: { help: "h", description: "d" },
        },
      },
    });
    for (const id of ["no-help", "blank-help", "blank-description", "not-text", "not-an-object"]) {
      expect(catalog.lookup(id, "it")).toBeUndefined();
    }
    expect(catalog.lookup("Bad Id", "it")).toBeUndefined();
    expect(catalog.lookup("fine", "it")).toEqual({ title: "h", explanation: "d", fix: "h" });
  });

  it.each([
    ["nothing", undefined],
    ["text", "it"],
    ["an object with no rules", { lang: "it" }],
    ["rules that are not an object", { rules: [] }],
  ])("works with no Italian of axe at all when the file is %s", (_what, axeFile) => {
    const catalog = createRuleCatalog({ ...sources(), axeItalian: axeFile });
    expect(catalog.lookup("accesskeys", "it")).toBeUndefined();
    expect(catalog.lookup("color-contrast", "it")).toEqual(text("it"));
  });
});

describe("createRuleCatalog: a catalog of FlawDot that is wrong is a bug, so it fails at once", () => {
  const long = (length: number) => "x".repeat(length);
  const withOwn = (entry: unknown, language: "en" | "it" = "en") => {
    const own = { en: { rule: text("en") }, it: { rule: text("it") } };
    return () => createRuleCatalog({ ...sources(), own: { ...own, [language]: { rule: entry } } });
  };

  it.each([
    ["a blank title", { ...text("a"), title: "   " }],
    ["a title over the limit", { ...text("a"), title: long(201) }],
    ["an explanation over the limit", { ...text("a"), explanation: long(2001) }],
    ["a fix over the limit", { ...text("a"), fix: long(2001) }],
    ["a missing field", { title: "t", explanation: "e" }],
    ["a key that is not asked for", { ...text("a"), extra: "x" }],
    ["a text that is not text", { ...text("a"), fix: 3 }],
    ["an entry that is not an object", "text"],
  ])("throws for %s", (_what, entry) => {
    expect(withOwn(entry)).toThrow(FlawDotError);
    expect(withOwn(entry, "it")).toThrow(FlawDotError);
  });

  it("throws INTERNAL, and says which catalog is wrong without repeating its texts", () => {
    try {
      withOwn({ ...text("a"), title: "SECRET-TEXT", extra: "x" }, "it")();
      expect.unreachable("it must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(FlawDotError);
      const thrown = error as FlawDotError;
      expect(thrown.code).toBe("INTERNAL");
      expect(thrown.message).toContain("catalog");
      expect(thrown.message).toContain("it");
      expect(thrown.message).not.toContain("SECRET-TEXT");
    }
  });

  it("throws for a rule id that is not valid, and for a file that is not an object", () => {
    const own = (entry: unknown) => () =>
      createRuleCatalog({ ...sources(), own: { en: entry, it: {} } });
    expect(own({ "Not An Id": text("a") })).toThrow(FlawDotError);
    expect(own("text")).toThrow(FlawDotError);
    expect(own(undefined)).toThrow(FlawDotError);
    expect(own([text("a")])).toThrow(FlawDotError);
  });

  it("accepts texts exactly at the limits", () => {
    const edge = { title: long(200), explanation: long(2000), fix: long(2000) };
    expect(
      createRuleCatalog({ ...sources(), own: { en: { rule: edge }, it: {} } }).lookup("rule", "en"),
    ).toEqual(edge);
  });
});
