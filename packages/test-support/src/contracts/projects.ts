import { describe, expect, it } from "vitest";
import { rejectionOf } from "../errors.js";
import { useFixture, withSecondInstance, type RepositoriesFactory } from "../harness.js";

/**
 * What every `ProjectRepository` must do. A project is one site: the id comes from the origin (a host name,
 * and "-<port>" when the port is not the default of the scheme), so the same site is always the same project.
 */
export function runProjectRepositoryContract(factory: RepositoriesFactory<"projects">): void {
  describe("ProjectRepository contract", () => {
    const current = useFixture(factory);
    const projects = () => current().fixture.subject.projects;

    it("creates the project of an origin, with the time of the clock", async () => {
      const project = await projects().getOrCreate("https://example.com");

      expect(project).toEqual({
        id: "example.com",
        origin: "https://example.com",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
    });

    it("names a project of localhost after its port", async () => {
      const project = await projects().getOrCreate("http://localhost:3000");

      expect(project.id).toBe("localhost-3000");
      expect(project.origin).toBe("http://localhost:3000");
    });

    it("names a project of any host after its port when the port is not the default one", async () => {
      expect((await projects().getOrCreate("https://example.com:8443")).id).toBe(
        "example.com-8443",
      );
      expect((await projects().getOrCreate("http://example.com:8080")).id).toBe("example.com-8080");
    });

    it.each([
      ["a default port that is written out", "http://example.com:80", "example.com"],
      ["the default port of https that is written out", "https://example.com:443", "example.com"],
      ["a dot at the end of the host", "http://localhost.:3000", "localhost-3000"],
      ["capital letters in the host", "http://LocalHost:3000", "localhost-3000"],
      ["an IPv4 address", "http://127.0.0.1:8080", "127.0.0.1-8080"],
      ["a host in other letters than ASCII", "https://bücher.example", "xn--bcher-kva.example"],
    ])("reads the id of a project from %s", async (_label, origin, id) => {
      expect((await projects().getOrCreate(origin)).id).toBe(id);
    });

    it("gives back the same project for the same site, however the origin is written", async () => {
      const first = await projects().getOrCreate("https://example.com");
      current().clock.advance(60_000);

      const again = await projects().getOrCreate("HTTPS://Example.COM:443/some/path?q=1#top");

      expect(again).toEqual(first);
      expect(await projects().list()).toHaveLength(1);
    });

    it("keeps the origin and the creation time of the first call", async () => {
      await projects().getOrCreate("http://example.com");
      current().clock.advance(1000);

      const second = await projects().getOrCreate("https://example.com");

      expect(second.origin).toBe("http://example.com");
      expect(second.createdAt).toBe("2026-01-01T00:00:00.000Z");
    });

    it("tells two ports of one host apart", async () => {
      const a = await projects().getOrCreate("http://localhost:3000");
      const b = await projects().getOrCreate("http://localhost:4000");

      expect(a.id).not.toBe(b.id);
    });

    it.each([
      ["a scheme that is not http or https", "ftp://example.com"],
      ["a user name and a password", "https://user:secret@example.com"],
      ["text that is not a URL", "not a url"],
      ["an empty string", ""],
      ["an IPv6 address, which is not a host name", "http://[2001:db8::1]:3000"],
    ])("rejects %s", async (_label, origin) => {
      const error = await rejectionOf(() => projects().getOrCreate(origin));

      expect(error.code).toBe("INVALID_INPUT");
      expect(await projects().list()).toEqual([]);
    });

    it("never repeats a secret that was in the rejected origin", async () => {
      const error = await rejectionOf(() =>
        projects().getOrCreate("https://user:CANARY-secret-password@example.com"),
      );

      expect(error.message).not.toContain("CANARY-secret-password");
    });

    it("lists the projects in the order they were created, and by id when they were created together", async () => {
      await projects().getOrCreate("https://zebra.example");
      current().clock.advance(1000);
      await projects().getOrCreate("https://apple.example");
      current().clock.advance(1000);
      await projects().getOrCreate("https://mango.example");
      await projects().getOrCreate("https://banana.example");

      const ids = (await projects().list()).map((project) => project.id);

      expect(ids).toEqual(["zebra.example", "apple.example", "banana.example", "mango.example"]);
    });

    it("lists nothing when there is no project", async () => {
      expect(await projects().list()).toEqual([]);
    });

    it("hands out copies: changing what it gave back does not change the store", async () => {
      const created = await projects().getOrCreate("https://example.com");
      (created as { origin: string }).origin = "https://changed.example";
      const [listed] = await projects().list();
      (listed as { origin: string }).origin = "https://changed.example";

      expect((await projects().getOrCreate("https://example.com")).origin).toBe(
        "https://example.com",
      );
    });

    it("does not share projects between two instances", async () => {
      await projects().getOrCreate("https://example.com");

      await withSecondInstance(factory, current().clock, async (second) => {
        expect(await second.subject.projects.list()).toEqual([]);
      });
    });
  });
}
