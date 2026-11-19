import { describe, expect, it } from "vitest";
import { layoutAnnotation } from "../src/layout.js";
import { renderMarksSvg } from "../src/svg.js";
import { DEFAULT_THEME } from "../src/theme.js";
import { finding } from "./support/builders.js";

const IMAGE = { width: 800, height: 600, scale: 1 };

const svgOf = (
  findings: ReturnType<typeof finding>[],
  image = IMAGE,
): { svg: string; marks: ReturnType<typeof layoutAnnotation>["marks"] } => {
  const annotation = layoutAnnotation(findings, image);
  return { svg: renderMarksSvg(annotation, image, DEFAULT_THEME), marks: annotation.marks };
};

const one = () => svgOf([finding(7, "critical", [300, 250, 100, 40])]);

describe("renderMarksSvg: the picture that goes over the screenshot", () => {
  it("is exactly as big as the screenshot, so that it can be laid over it", () => {
    const { svg } = one();
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="800" height="600" viewBox="0 0 800 600">/,
    );
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("uses no font, no marker and no filter: only shapes and outlines, which look the same on every system", () => {
    const { svg } = one();
    for (const forbidden of ["<text", "font-family", "<marker", "<filter", "<image", "<style"]) {
      expect(svg).not.toContain(forbidden);
    }
  });

  it("draws the disc of the severity, with a white ring around it", () => {
    const { svg, marks } = one();
    const center = marks[0]!.center;
    expect(svg).toContain(
      `<circle cx="${String(center.x)}" cy="${String(center.y)}" r="19" fill="#ffffff"/>`,
    );
    expect(svg).toContain(
      `<circle cx="${String(center.x)}" cy="${String(center.y)}" r="17" fill="#c8331f"/>`,
    );
  });

  it("colors the discs of medium and low with their own inks", () => {
    const { svg } = svgOf([
      finding(1, "medium", [100, 300, 40, 20]),
      finding(2, "low", [400, 300, 40, 20]),
    ]);
    expect(svg).toContain('r="14" fill="#9a5d00"');
    expect(svg).toContain('r="11" fill="#3a74a8"');
  });

  it("frames the element with four corners", () => {
    const { svg } = one();
    expect(svg).toContain(
      '<path d="M295 257V245H307M393 245H405V257M405 283V295H393M307 295H295V283" fill="none" stroke="#17201b" stroke-width="1.6"/>',
    );
  });

  it("draws the arrow as a shaft and a solid head, in the ink, and none when there is no arrow", () => {
    const { svg } = one();
    expect(svg.match(/<polygon /g)).toHaveLength(1);
    expect(svg).toMatch(
      /<path d="M[\d. -]+L[\d. -]+" fill="none" stroke="#17201b" stroke-width="1.6"\/>/,
    );

    const inside = svgOf([finding(1, "critical", [0, 0, 800, 600])]);
    expect(inside.svg).not.toContain("<polygon");
  });

  it("draws each number as outlines, in white, centered on its disc", () => {
    const { svg } = one();
    const numerals = svg.match(
      /<path transform="translate\([^"]+\) scale\([^"]+\)" d="[^"]+" fill="#ffffff"\/>/g,
    );
    expect(numerals).toHaveLength(1);
  });

  it("makes a number with three digits smaller so that it stays inside its disc", () => {
    const scaleOfFirstNumeral = (svg: string): number =>
      Number(/scale\(([\d.]+)\)" d="[^"]+" fill="#ffffff"/.exec(svg)?.[1]);
    const small = scaleOfFirstNumeral(svgOf([finding(1, "low", [300, 250, 100, 40])]).svg);
    const big = scaleOfFirstNumeral(svgOf([finding(100, "low", [300, 250, 100, 40])]).svg);
    expect(big).toBeLessThan(small);
  });

  it("draws, from the back to the front: the frames, the arrows, the discs, the numbers, the legend", () => {
    const { svg } = one();
    const at = (needle: string, from = 0): number => svg.indexOf(needle, from);
    const frame = at('fill="none" stroke="#17201b"');
    const head = at("<polygon");
    const ring = at('fill="#ffffff"/>');
    const number = at('fill="#ffffff"/>', ring + 1);
    const legend = at("<rect");
    expect(frame).toBeGreaterThan(-1);
    expect(frame).toBeLessThan(head);
    expect(head).toBeLessThan(ring);
    expect(ring).toBeLessThan(number);
    expect(number).toBeLessThan(legend);
  });
});

describe("renderMarksSvg: the legend", () => {
  it("has a plate and the three discs, with the labels as outlines", () => {
    const { svg } = one();
    expect(svg.match(/<rect /g)).toHaveLength(1);
    expect(svg).toContain('rx="4"');
    expect(svg).toContain('r="8.5" fill="#c8331f"');
    expect(svg).toContain('r="7" fill="#9a5d00"');
    expect(svg).toContain('r="5.5" fill="#3a74a8"');
    expect(svg.match(/fill="#17201b"\/>/g)?.length).toBeGreaterThan(10);
  });

  it("is left out when there is nothing to explain, and when the picture is too small", () => {
    expect(svgOf([]).svg).not.toContain("<rect");
    const small = { width: 120, height: 600, scale: 1 };
    expect(svgOf([finding(1, "low", [40, 300, 40, 20])], small).svg).not.toContain("<rect");
  });
});

describe("renderMarksSvg: the numbers it writes", () => {
  it("rounds every number to two decimals, so that the same input is the same picture", () => {
    const { svg } = svgOf([
      finding(1, "critical", [33.333333, 250.777777, 100.123456, 40.987654]),
      finding(2, "low", [433.3333, 250.1111, 100, 40]),
    ]);
    expect(svg).not.toMatch(/="-?\d+\.\d{3,}"/);
    expect(svg).not.toContain("NaN");
    expect(svg).not.toContain("Infinity");
    expect(svg).not.toContain("-0 ");
  });

  it("is the same string every time", () => {
    expect(one().svg).toBe(one().svg);
  });

  it("scales with the picture: at a ratio of 2 the disc has twice the radius", () => {
    const big = { width: 1600, height: 1200, scale: 2 };
    const { svg } = svgOf([finding(1, "critical", [300, 250, 100, 40])], big);
    expect(svg).toContain('r="38" fill="#ffffff"');
    expect(svg).toContain('r="34" fill="#c8331f"');
    // The frame and the shaft of the arrow, both at twice the width.
    expect(svg.match(/stroke-width="3.2"/g)).toHaveLength(2);
    expect(svg).not.toContain('stroke-width="1.6"');
  });
});
