import type { Finding, FindingState } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../errors.js";
import { findingId, fingerprint, makeFinding, makeRun, projectId, runId } from "../fixtures.js";
import { useFixture, withSecondInstance, type RepositoriesFactory } from "../harness.js";

const IGNORED = {
  kind: "ignored",
  reason: "not_a_problem",
  at: "2026-01-02T00:00:00.000Z",
} as const satisfies FindingState;

/**
 * What every `FindingRepository` must do. A finding belongs to a run that has to exist, and its id belongs to
 * that run alone. "Ignore" is a state of a project and a fingerprint, so it holds in the runs that come later.
 */
export function runFindingRepositoryContract(
  factory: RepositoriesFactory<"projects" | "runs" | "findings">,
): void {
  describe("FindingRepository contract", () => {
    const current = useFixture(factory);
    const findings = () => current().fixture.subject.findings;
    const example = projectId("example.com");
    const other = projectId("other.example");
    // Two runs of the project "example.com" (the ids 1 and 2) and one project more.
    const createRuns = async (): Promise<void> => {
      const { projects, runs } = current().fixture.subject;
      await projects.getOrCreate("https://example.com");
      await projects.getOrCreate("https://other.example");
      await runs.save(makeRun({ id: runId(1) }));
      await runs.save(makeRun({ id: runId(2) }));
    };
    const finding = (n: number, overrides: Partial<Finding> = {}): Finding =>
      makeFinding({ id: findingId(n), ...overrides });

    it("gives back the findings of a run that were saved", async () => {
      await createRuns();

      await findings().saveAll([finding(1), finding(2, { number: 2 })]);

      expect(await findings().byRun(runId(1))).toEqual([finding(1), finding(2, { number: 2 })]);
    });

    it("gives back the findings in the order of their ids, whatever the order they were saved in", async () => {
      await createRuns();

      await findings().saveAll([finding(5), finding(3)]);
      await findings().saveAll([finding(4)]);

      expect((await findings().byRun(runId(1))).map((f) => f.id)).toEqual([
        findingId(3),
        findingId(4),
        findingId(5),
      ]);
    });

    it("gives back only the findings of the run that was asked for", async () => {
      await createRuns();

      await findings().saveAll([finding(1), finding(2, { runId: runId(2) })]);

      expect((await findings().byRun(runId(2))).map((f) => f.id)).toEqual([findingId(2)]);
    });

    it("gives back nothing for a run without findings or one that does not exist", async () => {
      await createRuns();

      expect(await findings().byRun(runId(1))).toEqual([]);
      expect(await findings().byRun(runId(99))).toEqual([]);
    });

    it("replaces a finding that is saved again: it is how new circle numbers are stored", async () => {
      await createRuns();
      await findings().saveAll([finding(1, { number: 1 })]);

      await findings().saveAll([finding(1, { number: 4 })]);

      const saved = await findings().byRun(runId(1));
      expect(saved).toHaveLength(1);
      expect(saved[0]?.number).toBe(4);
    });

    it("saves nothing when one finding of the batch is not valid", async () => {
      await createRuns();
      const broken = { ...finding(2), number: 0 } as Finding; // circle numbers start at 1

      const error = await rejectionOf(() => findings().saveAll([finding(1), broken]));

      expect(error.code).toBe("INVALID_INPUT");
      expect(await findings().byRun(runId(1))).toEqual([]);
    });

    it("rejects a finding of a run that does not exist, and saves nothing", async () => {
      await createRuns();

      const error = await rejectionOf(() =>
        findings().saveAll([finding(1), finding(2, { runId: runId(99) })]),
      );

      expect(error.code).toBe("INVALID_INPUT");
      expect(error.message).toBe("Run not found");
      expect(await findings().byRun(runId(1))).toEqual([]);
    });

    it("rejects the id of a finding that belongs to another run", async () => {
      await createRuns();
      await findings().saveAll([finding(1)]);

      const error = await rejectionOf(() => findings().saveAll([finding(1, { runId: runId(2) })]));

      expect(error.code).toBe("INVALID_INPUT");
      expect((await findings().byRun(runId(1))).map((f) => f.id)).toEqual([findingId(1)]);
      expect(await findings().byRun(runId(2))).toEqual([]);
    });

    it("rejects a batch that has the same id under two runs, and saves nothing", async () => {
      await createRuns();

      const error = await rejectionOf(() =>
        findings().saveAll([finding(1), finding(1, { runId: runId(2) })]),
      );

      expect(error.code).toBe("INVALID_INPUT");
      expect(await findings().byRun(runId(1))).toEqual([]);
      expect(await findings().byRun(runId(2))).toEqual([]);
    });

    it("saves an empty batch without an error and without a change", async () => {
      await createRuns();
      await findings().saveAll([finding(1)]);

      await findings().saveAll([]);

      expect(await findings().byRun(runId(1))).toHaveLength(1);
    });

    it("hands out copies: neither the saved finding nor the one that was read is shared with the store", async () => {
      await createRuns();
      const saved = finding(1);
      await findings().saveAll([saved]);
      (saved as { title: string }).title = "Changed by the caller";
      const [read] = await findings().byRun(runId(1));
      (read as { title: string }).title = "Changed after reading";

      expect((await findings().byRun(runId(1)))[0]?.title).toBe("Title");
    });

    it("starts with no state: nothing is ignored", async () => {
      await createRuns();

      expect((await findings().states(example)).size).toBe(0);
    });

    it("remembers an ignored fingerprint, with its reason and its time", async () => {
      await createRuns();

      await findings().setState(example, fingerprint("a"), IGNORED);

      expect((await findings().states(example)).get(fingerprint("a"))).toEqual(IGNORED);
    });

    it("replaces the state of a fingerprint", async () => {
      await createRuns();
      await findings().setState(example, fingerprint("a"), IGNORED);
      const falsePositive: FindingState = { ...IGNORED, reason: "false_positive" };

      await findings().setState(example, fingerprint("a"), falsePositive);

      expect((await findings().states(example)).get(fingerprint("a"))).toEqual(falsePositive);
    });

    it("forgets the state of a fingerprint that is opened again, and lists only the ignored ones", async () => {
      await createRuns();
      await findings().setState(example, fingerprint("a"), IGNORED);
      await findings().setState(example, fingerprint("b"), IGNORED);

      await findings().setState(example, fingerprint("a"), { kind: "open" });

      expect([...(await findings().states(example)).keys()]).toEqual([fingerprint("b")]);
    });

    it("accepts opening a fingerprint that was never ignored", async () => {
      await createRuns();

      await findings().setState(example, fingerprint("c"), { kind: "open" });

      expect((await findings().states(example)).size).toBe(0);
    });

    it("keeps the states of each project apart", async () => {
      await createRuns();

      await findings().setState(example, fingerprint("a"), IGNORED);

      expect((await findings().states(other)).size).toBe(0);
    });

    it("holds the state in the runs that come later: it belongs to the project, not to a run", async () => {
      await createRuns();
      await findings().setState(example, fingerprint("a"), IGNORED);
      await current().fixture.subject.runs.save(makeRun({ id: runId(3) }));
      await findings().saveAll([finding(3, { runId: runId(3), fingerprint: fingerprint("a") })]);

      expect((await findings().states(example)).has(fingerprint("a"))).toBe(true);
    });

    it("gives a map that is a copy: changing it does not change the store", async () => {
      await createRuns();
      await findings().setState(example, fingerprint("a"), IGNORED);
      const read = (await findings().states(example)) as Map<string, FindingState>;
      read.delete(fingerprint("a"));
      read.set(fingerprint("z"), IGNORED);

      expect([...(await findings().states(example)).keys()]).toEqual([fingerprint("a")]);
    });

    it("rejects a state for a project that does not exist", async () => {
      const error = await rejectionOf(() =>
        findings().setState(projectId("nobody.example"), fingerprint("a"), IGNORED),
      );

      expect(error.code).toBe("INVALID_INPUT");
    });

    it.each([
      ["a fingerprint that is not 64 hexadecimal characters", "not-a-fingerprint", IGNORED],
      [
        "a state with a reason that does not exist",
        fingerprint("a"),
        { kind: "ignored", reason: "because", at: "2026-01-02T00:00:00.000Z" },
      ],
      [
        "a state with a time that is not a date",
        fingerprint("a"),
        { kind: "ignored", reason: "false_positive", at: "yesterday" },
      ],
    ])("rejects %s, and keeps what it knew", async (_label, key, state) => {
      await createRuns();
      await findings().setState(example, fingerprint("b"), IGNORED);

      const error = await rejectionOf(() =>
        findings().setState(example, key, state as FindingState),
      );

      expect(error.code).toBe("INVALID_INPUT");
      expect([...(await findings().states(example)).keys()]).toEqual([fingerprint("b")]);
    });

    it("does not share findings between two instances", async () => {
      await createRuns();
      await findings().saveAll([finding(1)]);

      await withSecondInstance(factory, current().clock, async (second) => {
        expect(await second.subject.findings.byRun(runId(1))).toEqual([]);
      });
    });
  });
}
