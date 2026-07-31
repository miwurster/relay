import { describe, expect, it } from "vitest";
import { ALL_SCENARIOS, resolveScenario, resolveScenarios } from "../../rehearsal/scenarios.js";

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

  it("gives bug-report and single-spec no tickets, so the work item is the ticket", () => {
    expect(resolveScenario("bug-report").tickets).toEqual([]);
    expect(resolveScenario("single-spec").tickets).toEqual([]);
  });

  it("refuses an unknown name, and says which scenarios exist", () => {
    expect(() => resolveScenario("red-gate")).toThrow(/red-gate/);
    expect(() => resolveScenario("red-gate")).toThrow(/happy-path/);
  });

  it("refuses `all`, which is the seed's name and not a scenario", () => {
    expect(() => resolveScenario(ALL_SCENARIOS)).toThrow();
  });
});

/**
 * The seed's own lookup, which takes one name more than the rehearsal's.
 *
 * Tested separately from `resolveScenario` because `all` is the whole point of it,
 * and because the seed is the destructive caller: what it resolves decides how
 * many work items exist after every issue in the repo has been deleted.
 */
describe("resolveScenarios", () => {
  it("gives every scenario for `all`", () => {
    const names = resolveScenarios(ALL_SCENARIOS).map(({ name }) => name);

    expect(names).toEqual(["happy-path", "bug-report", "single-spec"]);
  });

  it("leads with happy-path, which an oldest-first frontier makes the auto-pick", () => {
    const [first] = resolveScenarios(ALL_SCENARIOS);

    expect(first.name).toBe("happy-path");
  });

  it("gives just the one for a scenario's own name", () => {
    expect(resolveScenarios("bug-report").map(({ name }) => name)).toEqual(["bug-report"]);
  });

  it("names `all` in its refusal, since that is what a mistyped `all` was reaching for", () => {
    expect(() => resolveScenarios("al")).toThrow(/al/);
    expect(() => resolveScenarios("al")).toThrow(new RegExp(ALL_SCENARIOS));
  });

  it("reserves `all`, so no scenario can shadow it", () => {
    const names = resolveScenarios(ALL_SCENARIOS).map(({ name }) => name);

    expect(names).not.toContain(ALL_SCENARIOS);
  });
});
