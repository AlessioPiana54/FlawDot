import { describe, expect, it } from "vitest";
import { distanceToRect, distanceToSegment } from "../src/geometry.js";
import { layoutMarks, type PlacedMark } from "../src/layout.js";
import { measureLegend } from "../src/legend.js";
import { DEFAULT_THEME } from "../src/theme.js";
import { finding, seeded, type BoxTuple } from "./support/builders.js";

const IMAGE = { width: 800, height: 600, scale: 1 };
const SQRT_HALF = Math.SQRT1_2;

const only = (box: BoxTuple, severity: "critical" | "medium" | "low" = "critical"): PlacedMark => {
  const [mark] = layoutMarks([finding(1, severity, box)], IMAGE);
  if (mark === undefined) throw new Error("the mark was not placed");
  return mark;
};

describe("layoutMarks: where a circle goes", () => {
  it("puts a circle in the open at the top left of the element, on the diagonal, and frames the element", () => {
    const mark = only([300, 250, 100, 40]);
    expect(mark.direction).toBe("nw");
    expect(mark.number).toBe(1);
    expect(mark.severity).toBe("critical");
    expect(mark.radius).toBe(17);
    expect(mark.ring).toBe(2);
    expect(mark.center).toEqual({ x: 245, y: 195 });
    expect(mark.bracket).toEqual({ x: 295, y: 245, width: 110, height: 50 });
    expect(mark.arm).toBe(12);
  });

  it("draws an arrow from the edge of the circle to just before the corner, at exactly 45 degrees", () => {
    const { arrow, center } = only([300, 250, 100, 40]);
    expect(arrow).not.toBeNull();
    expect(arrow?.ux).toBeCloseTo(SQRT_HALF, 10);
    expect(arrow?.uy).toBeCloseTo(SQRT_HALF, 10);
    expect(arrow?.from.x).toBeCloseTo(center.x + 19 * SQRT_HALF, 6);
    expect(arrow?.from.y).toBeCloseTo(center.y + 19 * SQRT_HALF, 6);
    expect(arrow?.to.x).toBeCloseTo(295 - 3 * SQRT_HALF, 6);
    expect(arrow?.to.y).toBeCloseTo(245 - 3 * SQRT_HALF, 6);
  });

  it("sizes the circle by severity: the size is the first code", () => {
    expect(only([300, 250, 100, 40], "critical").radius).toBe(17);
    expect(only([300, 250, 100, 40], "medium").radius).toBe(14);
    expect(only([300, 250, 100, 40], "low").radius).toBe(11);
  });

  it("goes to the top right when the left edge of the image leaves no room", () => {
    const mark = only([2, 250, 100, 40]);
    expect(mark.direction).toBe("ne");
    expect(mark.bracket).toEqual({ x: 0, y: 245, width: 107, height: 50 });
    expect(mark.center).toEqual({ x: 157, y: 195 });
    expect(mark.arrow?.ux).toBeCloseTo(-SQRT_HALF, 10);
    expect(mark.arrow?.uy).toBeCloseTo(SQRT_HALF, 10);
  });

  it("goes to the bottom left when there is no room above", () => {
    const mark = only([300, 8, 100, 40]);
    expect(mark.direction).toBe("sw");
    expect(mark.center.y).toBeGreaterThan(mark.bracket.y + mark.bracket.height);
  });

  it("goes to the bottom right for an element in the top left corner, where nothing else is free", () => {
    const mark = only([2, 2, 100, 40]);
    expect(mark.direction).toBe("se");
    expect(mark.center).toEqual({ x: 157, y: 97 });
  });

  it("goes straight above, with a vertical arrow, when only that is free", () => {
    // Room above and a wall on both sides: a diagonal does not fit, a vertical line does.
    const narrow = layoutMarks([finding(1, "critical", [10, 300, 780, 40])], IMAGE)[0];
    expect(narrow?.direction).toBe("n");
    expect(narrow?.arrow?.ux).toBeCloseTo(0, 10);
    expect(narrow?.arrow?.uy).toBeCloseTo(1, 10);
    expect(narrow?.center.x).toBeCloseTo(narrow?.arrow?.to.x ?? -1, 6);
  });

  it("keeps a circle that goes inside the element inside the picture", () => {
    const mark = only([790, 0, 10, 600]);
    expect(mark.direction).toBe("inside");
    expect(mark.center.x + 19).toBeLessThanOrEqual(800);
  });

  it("keeps a circle inside the picture at the bottom as well, in a picture too narrow for any line", () => {
    const narrow = { width: 30, height: 600, scale: 1 };
    const [mark] = layoutMarks([finding(1, "critical", [0, 570, 30, 30])], narrow);
    expect(mark?.direction).toBe("inside");
    expect(mark!.center.y + 19).toBeLessThanOrEqual(600);
  });

  it("puts the circle inside the element, with no arrow, only when the element fills the whole picture", () => {
    const mark = only([0, 0, 800, 600]);
    expect(mark.direction).toBe("inside");
    expect(mark.arrow).toBeNull();
    expect(mark.center.x - 19).toBeGreaterThanOrEqual(0);
    expect(mark.center.y - 19).toBeGreaterThanOrEqual(0);
  });
});

describe("layoutMarks: the scale of the image", () => {
  it("makes every size and distance twice as big at a pixel ratio of 2, and keeps the place on the element", () => {
    const mark = layoutMarks([finding(1, "critical", [300, 250, 100, 40])], {
      width: 1600,
      height: 1200,
      scale: 2,
    })[0];
    expect(mark?.radius).toBe(34);
    expect(mark?.ring).toBe(4);
    expect(mark?.arm).toBe(24);
    expect(mark?.bracket).toEqual({ x: 590, y: 490, width: 220, height: 100 });
    expect(mark?.center).toEqual({ x: 490, y: 390 });
  });
});

describe("layoutMarks: boxes that are not tidy", () => {
  it("skips an element that is entirely outside the picture", () => {
    expect(layoutMarks([finding(1, "low", [1000, 100, 50, 50])], IMAGE)).toEqual([]);
    expect(layoutMarks([finding(1, "low", [100, 900, 50, 50])], IMAGE)).toEqual([]);
    expect(layoutMarks([finding(1, "low", [-200, 100, 50, 50])], IMAGE)).toEqual([]);
  });

  it("frames only the part of an element that is in the picture", () => {
    const mark = only([-30, 100, 60, 40]);
    expect(mark.bracket).toEqual({ x: 0, y: 95, width: 35, height: 50 });
  });

  it("frames an element with no size as a small square, with short arms", () => {
    const mark = only([300, 250, 0, 0]);
    expect(mark.bracket).toEqual({ x: 295, y: 245, width: 10, height: 10 });
    expect(mark.arm).toBe(5);
  });

  it("does not draw a finding of the page, or one with no number", () => {
    const marks = layoutMarks(
      [
        finding(1, "low", [0, 0, 0, 0], { page: true }),
        finding(2, "low", [100, 100, 20, 20], { number: null }),
        finding(3, "low", [300, 300, 20, 20]),
      ],
      IMAGE,
    );
    expect(marks.map((mark) => mark.number)).toEqual([3]);
  });
});

describe("layoutMarks: several circles", () => {
  it("gives the numbers in order whatever the order of the input, and does not change its input", () => {
    const input = [
      finding(3, "low", [500, 300, 40, 20]),
      finding(1, "critical", [100, 300, 40, 20]),
      finding(2, "medium", [300, 300, 40, 20]),
    ];
    const snapshot = JSON.stringify(input);
    const marks = layoutMarks(input, IMAGE);
    expect(marks.map((mark) => mark.number)).toEqual([1, 2, 3]);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(layoutMarks([...input].reverse(), IMAGE)).toEqual(marks);
  });

  it("orders by the number of the circle, not by the id of the finding", () => {
    const marks = layoutMarks(
      [
        finding(1, "low", [100, 300, 40, 20], { idSeed: 9 }),
        finding(2, "low", [300, 300, 40, 20], { idSeed: 1 }),
      ],
      IMAGE,
    );
    expect(marks.map((mark) => mark.number)).toEqual([1, 2]);
  });

  it("moves the second of two circles on the same element, and keeps the first where it was", () => {
    const [first, second] = layoutMarks(
      [finding(1, "critical", [300, 250, 100, 40]), finding(2, "critical", [300, 250, 100, 40])],
      IMAGE,
    );
    expect(first?.direction).toBe("nw");
    expect(second?.direction).toBe("ne");
    expect(second?.center).toEqual({ x: 455, y: 195 });
  });

  it("keeps a gap between two circles, so that their rings never touch", () => {
    // Two critical circles are 38 apart when they touch; the second is placed 39 away, which is inside the gap of 2.
    const [first, second] = layoutMarks(
      [finding(1, "critical", [300, 250, 100, 40]), finding(2, "critical", [339, 250, 100, 40])],
      IMAGE,
    );
    expect(first?.direction).toBe("nw");
    expect(second?.direction).not.toBe("nw");
    expect(
      Math.hypot(first!.center.x - second!.center.x, first!.center.y - second!.center.y),
    ).toBeGreaterThanOrEqual(38 + DEFAULT_THEME.gap);
  });

  it("keeps a circle off the arrow of an earlier one", () => {
    // The usual place of the second circle is on the arrow of the first, but far enough from its disc.
    const [first, second] = layoutMarks(
      [finding(1, "critical", [300, 250, 100, 40]), finding(2, "critical", [340, 290, 100, 40])],
      IMAGE,
    );
    expect(second?.center).not.toEqual({ x: 285, y: 235 });
    expect(
      distanceToSegment(second!.center, first!.arrow!.from, first!.arrow!.to),
    ).toBeGreaterThanOrEqual(second!.radius + second!.ring + DEFAULT_THEME.gap);
  });

  it("does not move a circle that was placed because another one comes after it", () => {
    const one = [finding(1, "critical", [300, 250, 100, 40])];
    const two = [...one, finding(2, "critical", [300, 250, 100, 40])];
    expect(layoutMarks(two, IMAGE)[0]).toEqual(layoutMarks(one, IMAGE)[0]);
  });

  it("moves a circle toward its element, along the same line, when the usual place is taken by the legend", () => {
    const small = { width: 330, height: 200, scale: 1 };
    const legend = measureLegend(small, DEFAULT_THEME)!;
    const [mark] = layoutMarks([finding(1, "critical", [250, 10, 60, 90])], small);
    expect(mark?.direction).toBe("sw");
    // The usual place, 50 pixels along the diagonal, is on the legend: it is nearer the element.
    expect(mark!.center.y).toBeLessThan(legend.plate.y);
    expect(distanceToRect(mark!.center, legend.plate)).toBeGreaterThanOrEqual(
      mark!.radius + mark!.ring + DEFAULT_THEME.gap,
    );
    const along = 245 - mark!.center.x;
    expect(mark!.center.y).toBeCloseTo(105 + along, 6);
    expect(along).toBeLessThan(50);
  });

  it("never covers the legend, and keeps clear of it", () => {
    const legend = measureLegend(IMAGE, DEFAULT_THEME)!;
    const marks = layoutMarks(
      [
        finding(1, "critical", [600, 520, 60, 20]),
        finding(2, "medium", [680, 500, 40, 30]),
        finding(3, "low", [500, 540, 50, 20]),
      ],
      IMAGE,
    );
    expect(marks).toHaveLength(3);
    for (const mark of marks) {
      expect(distanceToRect(mark.center, legend.plate)).toBeGreaterThanOrEqual(
        mark.radius + mark.ring,
      );
    }
  });
});

describe("layoutMarks: what is always true", () => {
  const random = seeded(7);
  const spread = (count: number, width: number, height: number): ReturnType<typeof finding>[] =>
    Array.from({ length: count }, (_, index) => {
      const w = 10 + random() * 200;
      const h = 8 + random() * 80;
      const severities = ["critical", "medium", "low"] as const;
      return finding(index + 1, severities[Math.floor(random() * 3)] ?? "low", [
        random() * (width - w),
        random() * (height - h),
        w,
        h,
      ]);
    });

  it("keeps every circle inside the picture and every arrow at 45 or 90 degrees, with room to spare", () => {
    const image = { width: 800, height: 1200, scale: 1 };
    for (let round = 0; round < 25; round++) {
      for (const mark of layoutMarks(spread(10, 800, 1200), image)) {
        const reach = mark.radius + mark.ring;
        expect(mark.center.x - reach).toBeGreaterThanOrEqual(0);
        expect(mark.center.y - reach).toBeGreaterThanOrEqual(0);
        expect(mark.center.x + reach).toBeLessThanOrEqual(image.width);
        expect(mark.center.y + reach).toBeLessThanOrEqual(image.height);
        if (mark.arrow !== null) {
          const { ux, uy } = mark.arrow;
          const diagonal = Math.abs(Math.abs(ux) - Math.abs(uy)) < 1e-9 && Math.abs(ux) > 0.5;
          const straight = Math.abs(ux) < 1e-9 || Math.abs(uy) < 1e-9;
          expect(diagonal || straight, `${String(ux)} ${String(uy)}`).toBe(true);
        }
      }
    }
  });

  it("keeps the circles apart from each other and from the arrows of the others", () => {
    const image = { width: 800, height: 1200, scale: 1 };
    const gap = DEFAULT_THEME.gap;
    for (let round = 0; round < 25; round++) {
      const marks = layoutMarks(spread(8, 800, 1200), image);
      for (const [i, a] of marks.entries()) {
        for (const [j, b] of marks.entries()) {
          if (i >= j) continue;
          expect(
            Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y),
          ).toBeGreaterThanOrEqual(a.radius + a.ring + b.radius + b.ring + gap - 1e-9);
        }
        for (const [j, b] of marks.entries()) {
          if (i === j || b.arrow === null) continue;
          expect(distanceToSegment(a.center, b.arrow.from, b.arrow.to)).toBeGreaterThanOrEqual(
            a.radius + a.ring + gap - 1e-9,
          );
        }
      }
    }
  });

  it("is the same every time", () => {
    const input = spread(12, 800, 1200);
    const image = { width: 800, height: 1200, scale: 1 };
    expect(layoutMarks(input, image)).toEqual(layoutMarks(input, image));
  });

  it("still places every circle, inside the picture, when there is no room left", () => {
    const crowd = Array.from({ length: 80 }, (_, index) =>
      finding(index + 1, "critical", [300, 250, 100, 40]),
    );
    const marks = layoutMarks(crowd, IMAGE);
    expect(marks).toHaveLength(80);
    for (const mark of marks) {
      if (mark.arrow === null) continue;
      const slid = Math.hypot(mark.center.x - mark.arrow.to.x, mark.center.y - mark.arrow.to.y);
      // A circle never goes further from its element than the theme allows, a few pixels more for the gap of the arrow.
      expect(slid).toBeLessThanOrEqual(
        DEFAULT_THEME.maxSlide * Math.SQRT2 + DEFAULT_THEME.tipGap + 1e-6,
      );
    }
    for (const mark of marks) {
      const reach = mark.radius + mark.ring;
      expect(mark.center.x - reach).toBeGreaterThanOrEqual(0);
      expect(mark.center.x + reach).toBeLessThanOrEqual(IMAGE.width);
      expect(mark.center.y - reach).toBeGreaterThanOrEqual(0);
      expect(mark.center.y + reach).toBeLessThanOrEqual(IMAGE.height);
    }
  });

  it("copes with a very tall page", () => {
    const tall = { width: 1440, height: 6000, scale: 1 };
    const marks = layoutMarks(
      [finding(1, "critical", [100, 5975, 300, 20]), finding(2, "low", [1300, 3, 100, 20])],
      tall,
    );
    expect(marks).toHaveLength(2);
    for (const mark of marks) expect(mark.center.y + mark.radius).toBeLessThanOrEqual(6000);
  });
});
