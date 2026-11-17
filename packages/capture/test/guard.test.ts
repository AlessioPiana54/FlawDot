import { describe, expect, it } from "vitest";
import { createGuard } from "../src/guard.js";
import { rejectionOf } from "./support/fakes.js";

const never = (): Promise<never> => new Promise(() => undefined);

describe("createGuard", () => {
  it("gives back what the work gives back, and what it throws", async () => {
    const guard = createGuard("https://example.com/", 1000);
    await expect(guard(Promise.resolve(42))).resolves.toBe(42);
    const failure = new Error("nope");
    await expect(guard(Promise.reject(failure))).rejects.toBe(failure);
  });

  it("stops waiting for work that does not end, with TIMEOUT that names only the origin", async () => {
    const guard = createGuard("https://example.com/path?token=SECRET123", 30);
    const error = await rejectionOf(guard(never()));
    expect(error).toMatchObject({ code: "TIMEOUT", retryable: true });
    expect(String((error as Error).message)).toContain("https://example.com");
    expect(String((error as Error).message)).not.toContain("SECRET123");
  });

  it("does not leave a timer running when the work ends first", async () => {
    const guard = createGuard("https://example.com/", 60_000);
    const started = Date.now();
    await guard(Promise.resolve("done"));
    expect(Date.now() - started).toBeLessThan(1000); // a timer left running would also keep the process alive
  });
});
