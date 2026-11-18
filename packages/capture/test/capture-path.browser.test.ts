/// <reference lib="dom" />

import { beforeAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import {
  DEFAULT_VIEWPORTS,
  type Box,
  type Capture,
  type ElementPath,
  type LivePage,
} from "@flawdot/core-model";
import { createUrlCapture } from "../src/index.js";
import { useBrowserHarness } from "./support/harness.js";
import { context, fixedClock, idleSignal, target } from "./support/fakes.js";

// The box of an element in an iframe or in a shadow root, which a selector of the page cannot reach: the walk goes
// from step to step and the positions add up, in CSS pixels of the whole top page. Every box in the fixtures is
// written in pixels. A capture is the slow part, so each page is captured once, and every box is measured in that
// one visit; the tests below read what was measured.
const harness = useBrowserHarness();

/** Captures a page and, while it is still open, runs `run` with its live page. */
async function visit<T>(
  path: string,
  run: (live: LivePage) => Promise<T>,
): Promise<{ capture: Capture; result: T }> {
  let result: T | undefined;
  const capture = await createUrlCapture({
    browser: harness.provider,
    artifacts: harness.artifacts,
    clock: fixedClock,
  }).capture(
    target(`${harness.server.origin}${path}`),
    DEFAULT_VIEWPORTS.desktop,
    context(),
    idleSignal,
    async (live) => {
      result = await run(live);
    },
  );
  return { capture, result: result as T };
}

const at = (x: number, y: number, width: number, height: number): Box => ({ x, y, width, height });

const BOXES: Record<string, string | ElementPath> = {
  "button in the iframe": ["#frame", "#inner"],
  "button in the iframe in the iframe": ["#frame", "#deeper", "#deepest"],
  "element in a shadow root in the iframe": ["#frame", ["#sh", "#sx"]],
  "the iframe": ["#frame"],
  "element in a shadow root": [["#host", "#sb"]],
  "element in a shadow root in a shadow root": [["#host", "#mid", "#deep"]],
  "selector of the page": "#plain",
};
const NOWHERE: Record<string, unknown> = {
  "a step that finds nothing": ["#nope"],
  "an iframe that is not there": ["#nope", "#inner"],
  "an element that is not in the iframe": ["#frame", "#nope"],
  "a selector that is not valid": ["#frame", "###"],
  "a shadow root that is closed": [["#closed", "#cb"]],
  "a host that has no shadow root": [["#plain", "#x"]],
  "an element in a shadow root that is not there": [["#host", "#nope"]],
  "a step before the last that is not an iframe": ["#host", "#inner"],
  "a path with no step": [],
  "a step with no selector": [[]],
  "an empty selector": [""],
  "a step that is not a selector": [5],
  "a step with a selector that is not text": [["#host", 7]],
  "more steps than a page can have": Array.from({ length: 11 }, () => "#frame"),
};

interface Measured {
  capture: Capture;
  boxes: Map<string, Box | null>;
  nowhere: Map<string, Box | null>;
  /** The same two boxes after the page was scrolled down and across. */
  scrolled: { shadow: Box | null; inIframe: Box | null };
}

let host: Measured;
let hostile: Box | null;

beforeAll(async () => {
  const visited = await visit("/path-host.html", async (live) => {
    const boxes = new Map<string, Box | null>();
    for (const [name, path] of Object.entries(BOXES)) boxes.set(name, await live.boxOf(path));
    const nowhere = new Map<string, Box | null>();
    for (const [name, path] of Object.entries(NOWHERE)) {
      nowhere.set(name, await live.boxOf(path as ElementPath));
    }
    await (live.page as Page).evaluate(() => {
      window.scrollTo(300, 700);
    });
    return {
      boxes,
      nowhere,
      scrolled: {
        shadow: await live.boxOf([["#host", "#sb"]]),
        inIframe: await live.boxOf(["#frame", "#inner"]),
      },
    };
  });
  host = { capture: visited.capture, ...visited.result };
  // A page that has replaced `document.querySelector` and the `shadowRoot` of its host.
  hostile = (await visit("/path-hostile.html", (live) => live.boxOf([["#host", "#sb"]]))).result;
}, 120_000);

describe("boxOf with the path to an element in an iframe", () => {
  it("adds the position of the iframe and its border to the position of the element in it", () => {
    // The iframe is at 50,100 with a border of 5, and the button is at 40,30 inside it.
    expect(host.boxes.get("button in the iframe")).toEqual(at(95, 135, 80, 24));
  });

  it("goes through an iframe in an iframe", () => {
    // #deeper is at 10,70 in #inner's document, and #deepest at 7,5 in it.
    expect(host.boxes.get("button in the iframe in the iframe")).toEqual(at(72, 180, 30, 12));
  });

  it("goes into a shadow root inside the iframe", () => {
    expect(host.boxes.get("element in a shadow root in the iframe")).toEqual(at(58, 247, 10, 10));
  });

  it("gives the box of the iframe itself, border included, when the path ends there", () => {
    expect(host.boxes.get("the iframe")).toEqual(at(50, 100, 310, 210));
  });
});

describe("boxOf with the path to an element in a shadow root", () => {
  it("finds an element in the open shadow root of a host", () => {
    expect(host.boxes.get("element in a shadow root")).toEqual(at(28, 404, 50, 20));
  });

  it("goes through a shadow root in a shadow root", () => {
    expect(host.boxes.get("element in a shadow root in a shadow root")).toEqual(
      at(125, 416, 20, 10),
    );
  });

  it("finds it also when the page has replaced `document.querySelector` and the `shadowRoot` of the host", () => {
    expect(hostile).toEqual(at(28, 104, 50, 20));
  });

  it("gives the same box when the page is scrolled, across and down: it is the box of the whole page, not of the window", () => {
    expect(host.scrolled.shadow).toEqual(host.boxes.get("element in a shadow root"));
    expect(host.scrolled.inIframe).toEqual(host.boxes.get("button in the iframe"));
    expect(host.scrolled.inIframe).toEqual(at(95, 135, 80, 24));
  });
});

describe("boxOf with a path that leads nowhere", () => {
  it.each(Object.keys(NOWHERE))("gives null for %s", (name) => {
    expect(host.nowhere.get(name)).toBeNull();
  });
});

describe("boxOf with a selector, as before", () => {
  it("still measures a selector of the page", () => {
    expect(host.boxes.get("selector of the page")).toEqual(at(20, 600, 100, 30));
  });
});

describe("an iframe is a mark of the capture", () => {
  it("is numbered, so that a finding about what is inside it has a circle to sit on", () => {
    const frame = host.capture.elements.find((entry) => entry.selector === "#frame");
    expect(frame).toMatchObject({ tag: "iframe", box: at(50, 100, 310, 210) });
  });
});
