import { describe, expect, it } from "vitest";
import { resolveScenario } from "../../rehearsal/scenarios.js";

/**
 * The scenario lookup, tested because it is what stands between a mistyped name
 * and a seed that deletes every issue in the rehearsal repo.
 *
 * The refusal is asserted through its load-bearing phrases rather than its full
 * text, the convention `tests/host/dirty-worktree.test.ts` uses, so editing
 * operator prose is not a test failure.
 */
describe("resolveScenario", () => {
  it("gives happy-path's tickets ids of their own to depend on", () => {
    const ids = resolveScenario("happy-path").tickets.map(({ id }) => id);

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives happy-path two tickets that wait on the first", () => {
    const [first, ...rest] = resolveScenario("happy-path").tickets;

    expect(first?.blockedBy ?? []).toEqual([]);
    for (const ticket of rest) {
      expect(ticket.blockedBy).toEqual([first?.id]);
    }
  });

  it("refuses an unknown name, and says which scenarios exist", () => {
    let reason = "";
    try {
      resolveScenario("red-gate");
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }

    expect(reason).toContain("red-gate");
    expect(reason).toContain("happy-path");
  });
});
