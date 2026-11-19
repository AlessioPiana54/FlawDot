import type { Run } from "@flawdot/core-model";
import { describe, expect, it } from "vitest";
import { rejectionOf } from "../errors.js";
import { makeRun, projectId, runId } from "../fixtures.js";
import { useFixture, withSecondInstance, type RepositoriesFactory } from "../harness.js";

/**
 * What every `RunRepository` must do. Runs are ordered by id: an id is a ULID, so it sorts by creation time,
 * and `before` of `latestCompleted` is an id too. A run belongs to a project that has to exist (a foreign key in SQL).
 */
export function runRunRepositoryContract(factory: RepositoriesFactory<"projects" | "runs">): void {
  describe("RunRepository contract", () => {
    const current = useFixture(factory);
    const runs = () => current().fixture.subject.runs;
    // The projects of the tests: "example.com" is the project of `makeRun`.
    const createProjects = async (): Promise<void> => {
      await current().fixture.subject.projects.getOrCreate("https://example.com");
      await current().fixture.subject.projects.getOrCreate("https://other.example");
    };
    const example = projectId("example.com");
    const other = projectId("other.example");
    const finished = (n: number, overrides: Partial<Run> = {}): Run =>
      makeRun({ id: runId(n), ...overrides });

    it("gives back the run that was saved", async () => {
      await createProjects();
      const run = finished(1);

      await runs().save(run);

      expect(await runs().get(run.id)).toEqual(run);
    });

    it("replaces a run that is saved again: it is how a run goes from running to completed", async () => {
      await createProjects();
      await runs().save(finished(1, { status: "running", finishedAt: null }));

      await runs().save(finished(1));

      expect((await runs().get(runId(1))).status).toBe("completed");
      expect(await runs().list(example)).toHaveLength(1);
    });

    it("rejects a run that is saved again under another project: a run never moves", async () => {
      await createProjects();
      await runs().save(finished(1));

      const error = await rejectionOf(() => runs().save(finished(1, { projectId: other })));

      expect(error.code).toBe("INVALID_INPUT");
      expect((await runs().list(example)).map((run) => run.id)).toEqual([runId(1)]);
      expect(await runs().list(other)).toEqual([]);
    });

    it("rejects the id of a run that does not exist, with a message that says what is missing", async () => {
      const error = await rejectionOf(() => runs().get(runId(5)));

      expect(error.code).toBe("INVALID_INPUT");
      expect(error.message).toBe("Run not found");
      expect(error.retryable).toBe(false);
    });

    it("rejects a run of a project that does not exist, and saves nothing", async () => {
      const error = await rejectionOf(() => runs().save(finished(1)));

      expect(error.code).toBe("INVALID_INPUT");
      expect(error.message).toBe("Project not found");
      await expect(runs().get(runId(1))).rejects.toThrow("Run not found");
    });

    it("rejects a run that breaks the rules of the model, and saves nothing", async () => {
      await createProjects();
      const broken = { ...finished(1), status: "running" } as Run; // it has an end time but is still running

      const error = await rejectionOf(() => runs().save(broken));

      expect(error.code).toBe("INVALID_INPUT");
      await expect(runs().get(runId(1))).rejects.toThrow("Run not found");
    });

    it("lists the runs of a project, the newest first", async () => {
      await createProjects();
      await runs().save(finished(2));
      await runs().save(finished(7));
      await runs().save(finished(4));

      const ids = (await runs().list(example)).map((run) => run.id);

      expect(ids).toEqual([runId(7), runId(4), runId(2)]);
    });

    it("lists only the runs of the project that was asked for", async () => {
      await createProjects();
      await runs().save(finished(1));
      await runs().save(finished(2, { projectId: other }));

      expect((await runs().list(other)).map((run) => run.id)).toEqual([runId(2)]);
    });

    it("lists nothing for a project that has no run or that does not exist", async () => {
      await createProjects();

      expect(await runs().list(other)).toEqual([]);
      expect(await runs().list(projectId("nobody.example"))).toEqual([]);
    });

    it("finds the newest completed run", async () => {
      await createProjects();
      await runs().save(finished(2));
      await runs().save(finished(5));

      expect((await runs().latestCompleted(example))?.id).toBe(runId(5));
    });

    it("never counts a run that is not completed", async () => {
      await createProjects();
      await runs().save(finished(2));
      await runs().save(finished(3, { status: "running", finishedAt: null }));
      await runs().save(finished(4, { status: "cancelled" }));
      await runs().save(finished(5, { status: "partial" }));

      expect((await runs().latestCompleted(example))?.id).toBe(runId(2));
    });

    it("finds nothing when no run is completed", async () => {
      await createProjects();
      await runs().save(finished(1, { status: "partial" }));

      expect(await runs().latestCompleted(example)).toBeNull();
      expect(await runs().latestCompleted(other)).toBeNull();
    });

    it("finds the newest completed run older than `before`, and `before` itself is not older", async () => {
      await createProjects();
      await runs().save(finished(2));
      await runs().save(finished(4));
      await runs().save(finished(6));

      expect((await runs().latestCompleted(example, runId(6)))?.id).toBe(runId(4));
      expect((await runs().latestCompleted(example, runId(4)))?.id).toBe(runId(2));
      expect(await runs().latestCompleted(example, runId(2))).toBeNull();
    });

    it("accepts a `before` that is not the id of a saved run", async () => {
      await createProjects();
      await runs().save(finished(2));
      await runs().save(finished(6));

      expect((await runs().latestCompleted(example, runId(5)))?.id).toBe(runId(2));
    });

    it("looks only at the project that was asked for", async () => {
      await createProjects();
      await runs().save(finished(9, { projectId: other }));

      expect(await runs().latestCompleted(example)).toBeNull();
    });

    it("hands out copies: neither the saved run nor the one that was read is shared with the store", async () => {
      await createProjects();
      const run = finished(1);
      await runs().save(run);
      (run.viewports as { name: string }[])[0]!.name = "mobile"; // the caller changes its own object
      const read = await runs().get(runId(1));
      (read.pages as { url: string }[])[0]!.url = "https://changed.example/";

      expect((await runs().get(runId(1))).viewports[0]?.name).toBe("desktop");
      expect((await runs().get(runId(1))).pages[0]?.url).toBe("https://example.com/");
    });

    it("hands out copies from a list and from the search for the latest run too", async () => {
      await createProjects();
      await runs().save(finished(1));
      const [listed] = await runs().list(example);
      (listed!.pages as { url: string }[])[0]!.url = "https://changed-in-list.example/";
      const latest = await runs().latestCompleted(example);
      (latest!.pages as { url: string }[])[0]!.url = "https://changed-in-latest.example/";

      expect((await runs().get(runId(1))).pages[0]?.url).toBe("https://example.com/");
    });

    it("does not share runs between two instances", async () => {
      await createProjects();
      await runs().save(finished(1));

      await withSecondInstance(factory, current().clock, async (second) => {
        await second.subject.projects.getOrCreate("https://example.com");
        expect(await second.subject.runs.list(example)).toEqual([]);
      });
    });
  });
}
