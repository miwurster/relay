import { describe, expect, it } from "vitest";
import { resolveLanding } from "../../rehearsal/seed.js";
import { LANDINGS } from "../../src/config.js";

/**
 * The landing lookup, tested for `resolveScenario`'s reason: it is what stands
 * between a mistyped argument and a seed that deletes every issue in the
 * rehearsal repo, and between an operator and a rehearsal that lands the way they
 * did not ask for.
 *
 * The refusal is asserted through its load-bearing phrases rather than its full
 * text, the convention `tests/host/dirty-worktree.test.ts` uses, so editing
 * operator prose is not a test failure.
 */
describe("resolveLanding", () => {
  it("accepts every landing relay itself declares, and no others", () => {
    for (const landing of LANDINGS) {
      expect(resolveLanding(landing)).toBe(landing);
    }
  });

  it("refuses an unknown landing, and says which ones exist", () => {
    let reason = "";
    try {
      resolveLanding("pr");
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }

    expect(reason).toContain("pr");
    for (const landing of LANDINGS) {
      expect(reason).toContain(landing);
    }
  });

  it("refuses an empty landing rather than defaulting to one", () => {
    expect(() => resolveLanding("")).toThrow();
  });
});
