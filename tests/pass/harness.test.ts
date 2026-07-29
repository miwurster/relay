import { describe, expect, it } from "vitest";
import {
  type Crew,
  type Finding,
  type FixTarget,
  type GateResult,
  type ImplementResult,
  type LandResult,
  NO_LANDING,
  type Outcome,
  type PlanResult,
  type ResolvedGate,
  type ReviewLens,
  type ReviewScope,
  type TicketRef,
} from "../../src/crew/contract.js";
import { ExitCode } from "../../src/exit-codes.js";
import { exitCodeFor, MAX_GATE_FIX_ATTEMPTS, runHarness } from "../../src/pass/harness.js";
import type { GitHubIssue } from "../../src/tracker/github.js";
import { createStubCrew } from "../crew/stub-crew.js";

const issue: GitHubIssue = {
  number: 1,
  labels: ["ready-for-agent"],
  isOpen: true,
  blockedBy: [],
  subIssues: [],
};

const resolvedGate: ResolvedGate = {
  command: "npm run verify",
  provenance: "declared",
  source: "AGENTS.md, under Verifying",
};

const run = (crew: Crew) => runHarness(crew, issue);

const ticket = (number: number): TicketRef => ({ number, summary: `work on #${number}` });

const finding = (source: Finding["source"], summary: string, ticket?: number): Finding => ({
  source,
  summary,
  ...(ticket ? { ticket } : {}),
});

/**
 * A two-ticket plan, for the tests about what a ticket's own lenses do: a
 * single-ticket plan has no per-ticket round at all.
 */
const twoTicketPlan = {
  async plan(): Promise<PlanResult> {
    return { kind: "plan", tickets: [ticket(1), ticket(2)] };
  },
};

/** A crew that records the order of every leg, with overridable roles. */
function recordingCrew(overrides: Partial<Crew> = {}) {
  const calls: string[] = [];
  const fixed: Finding[][] = [];
  const fixTargets: FixTarget[] = [];
  let handedOver: Outcome | undefined;
  let handedOverTickets: readonly TicketRef[] = [];
  let handedOverLand: LandResult = NO_LANDING;

  const crew: Crew = {
    async resolveGate(): Promise<ResolvedGate> {
      calls.push("resolveGate");
      return resolvedGate;
    },
    async plan(): Promise<PlanResult> {
      calls.push("plan");
      return { kind: "plan", tickets: [ticket(1)] };
    },
    async implement(ref): Promise<ImplementResult> {
      calls.push(`implement:${ref.number}`);
      return { kind: "done", base: "c0ffee" };
    },
    async review(lens: ReviewLens, scope: ReviewScope): Promise<Finding[]> {
      calls.push(`review:${lens}:${scope.kind === "ticket" ? scope.ticket.number : "branch"}`);
      return [];
    },
    async fix(findings, target): Promise<void> {
      calls.push("fix");
      fixed.push([...findings]);
      fixTargets.push(target);
    },
    async greenGate(): Promise<GateResult> {
      calls.push("gate");
      return { green: true, detail: "green" };
    },
    // The lander of a `pull-request` repo: it runs, and lands nothing.
    async land(): Promise<LandResult> {
      calls.push("land");
      return NO_LANDING;
    },
    async handover(outcome, committed, land): Promise<void> {
      calls.push(`handover:${outcome.kind}`);
      handedOver = outcome;
      handedOverTickets = committed;
      handedOverLand = land;
    },
    ...overrides,
  };

  return {
    crew,
    calls,
    fixed,
    fixTargets,
    handover: () => handedOver,
    committed: () => handedOverTickets,
    land: () => handedOverLand,
  };
}

describe("runHarness", () => {
  it("runs the full topology in order: plan, per-ticket loop, branch review, gate, land, handover", async () => {
    const { crew, calls } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:ticketReview:1",
      "implement:2",
      "review:ticketReview:2",
      "review:inDepthCodeReview:branch",
      "review:inDepthSpecReview:branch",
      "gate",
      "land",
      "handover:success",
    ]);
  });

  it("runs the lenses of a scope one at a time, since they share one worktree", async () => {
    const events: string[] = [];

    const { crew } = recordingCrew({
      ...twoTicketPlan,
      async review(lens: ReviewLens) {
        events.push(`start:${lens}`);
        await Promise.resolve();
        events.push(`end:${lens}`);
        return [];
      },
    });

    await run(crew);

    expect(events).toEqual([
      "start:ticketReview",
      "end:ticketReview",
      "start:ticketReview",
      "end:ticketReview",
      "start:inDepthCodeReview",
      "end:inDepthCodeReview",
      "start:inDepthSpecReview",
      "end:inDepthSpecReview",
    ]);
  });

  it("array-merges the lenses of a scope into one fixer call", async () => {
    const { crew, fixed } = recordingCrew({
      ...twoTicketPlan,
      async review(lens, scope) {
        if (scope.kind !== "ticket") return [];
        return [finding(lens, "same problem", scope.ticket.number)];
      },
    });

    await run(crew);

    expect(fixed[0]).toEqual([finding("ticketReview", "same problem", 1)]);
  });

  it("tells each fixer leg what it is fixing", async () => {
    const { crew, fixTargets } = recordingCrew({
      ...twoTicketPlan,
      async review(lens, scope) {
        const ticketNumber = scope.kind === "ticket" ? scope.ticket.number : undefined;
        return [finding(lens, "same problem", ticketNumber)];
      },
      async greenGate() {
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(fixTargets).toEqual([
      { kind: "ticket", ticket: ticket(1) },
      { kind: "ticket", ticket: ticket(2) },
      { kind: "branch" },
      { kind: "gate", attempt: 1 },
      { kind: "gate", attempt: 2 },
    ]);
  });

  it("reviews a single-ticket plan once, at branch scope, not twice", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:inDepthCodeReview:branch",
      "review:inDepthSpecReview:branch",
      "gate",
      "land",
      "handover:success",
    ]);
  });

  it("does not call the fixer when no lens found anything", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls).not.toContain("fix");
  });

  it("loops gate and fixer until green", async () => {
    const verdicts: GateResult[] = [
      { green: false, detail: "one test red" },
      { green: true, detail: "green" },
    ];
    const { crew, calls, fixed } = recordingCrew({
      async greenGate() {
        calls.push("gate");
        return verdicts.shift() ?? { green: true, detail: "green" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(calls.filter((call) => call === "gate")).toHaveLength(2);
    expect(fixed.at(-1)).toEqual([finding("greenGate", "one test red")]);
  });

  it("numbers each gate run, so the loop's legs stay apart", async () => {
    const attempts: number[] = [];
    const { crew } = recordingCrew({
      async greenGate(attempt) {
        attempts.push(attempt);
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("resolves the gate once and hands that same one to every attempt of the loop", async () => {
    const gates: ResolvedGate[] = [];
    const { crew, calls } = recordingCrew({
      async greenGate(_attempt, gate) {
        gates.push(gate);
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(gates).toHaveLength(3);
    expect(new Set(gates)).toEqual(new Set([gates[0]]));
    expect(gates[0]).toEqual(resolvedGate);
    expect(calls.filter((call) => call === "resolveGate")).toHaveLength(1);
  });

  it("gives up after two fixer attempts and mid-blocks on a red gate", async () => {
    const { crew, calls } = recordingCrew({
      async greenGate() {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "still red" });
    expect(calls.filter((call) => call === "fix")).toHaveLength(MAX_GATE_FIX_ATTEMPTS);
    expect(calls.at(-1)).toBe("handover:mid-block");
  });

  it("bails early on an under-specified item without implementing anything", async () => {
    const { crew, calls } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "early-bail", reason: "no acceptance criteria" });
    expect(calls).toEqual(["resolveGate", "plan", "handover:early-bail"]);
  });

  it("collapses a role that needs input into a mid-block handover, never a pause", async () => {
    const { crew, calls, committed } = recordingCrew({
      async plan() {
        calls.push("plan");
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
      async implement(ref) {
        calls.push(`implement:${ref.number}`);
        return { kind: "needs-input", reason: "which queue does this drain?" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "which queue does this drain?" });
    expect(committed()).toEqual([]);
    expect(calls).toEqual(["resolveGate", "plan", "implement:1", "handover:mid-block"]);
  });

  it("hands the handover the tickets committed before a block, and no more", async () => {
    const { crew, committed } = recordingCrew({
      async plan() {
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
      async implement(ref) {
        return ref.number === 2
          ? { kind: "needs-input", reason: "which queue does this drain?" }
          : { kind: "done", base: "c0ffee" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "which queue does this drain?" });
    expect(committed()).toEqual([ticket(1)]);
  });

  it("hands the handover every ticket of a pass that finished", async () => {
    const { crew, committed } = recordingCrew({
      async plan() {
        return { kind: "plan", tickets: [ticket(1), ticket(2)] };
      },
    });

    await run(crew);

    expect(committed()).toEqual([ticket(1), ticket(2)]);
  });

  it("hands an early bail over with no committed tickets", async () => {
    const { crew, committed } = recordingCrew({
      async plan() {
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    });

    await run(crew);

    expect(committed()).toEqual([]);
  });

  it("runs end to end on the stub crew", async () => {
    const outcome = await runHarness(createStubCrew(), issue);

    expect(outcome).toEqual({ kind: "success", detail: "stub gate is always green" });
  });

  it("runs end to end on the stub crew of a merge-landing repo", async () => {
    const outcome = await runHarness(createStubCrew({ landing: "merge" }), issue);

    expect(outcome).toEqual({ kind: "success", detail: "stub gate is always green" });
  });
});

/**
 * A lander that reports a landing is what `merge` landing looks like to the
 * harness, so these say what the pass does with one and what it does with the
 * lander of a repo that lands nothing.
 */
describe("runHarness under merge landing", () => {
  /** A crew whose lander reports `result`, recording its own leg and its re-gate. */
  function landingCrew(result: LandResult, overrides: Partial<Crew> = {}) {
    const recorder = recordingCrew(overrides);
    recorder.crew.land = async (regate) => {
      recorder.calls.push("land");
      await regate();
      return result;
    };
    return recorder;
  }

  const landed: LandResult = { kind: "landed", detail: "agent/1 was rebased onto main" };

  it("runs the lander between the gate loop and the handover", async () => {
    const { crew, calls } = landingCrew(landed);

    const outcome = await run(crew);

    // The gate that verified what landed stays the outcome's detail: the lander's
    // own story is handed to the handover beside it, not in place of it.
    expect(outcome).toEqual({ kind: "success", detail: "green" });
    expect(calls).toEqual([
      "resolveGate",
      "plan",
      "implement:1",
      "review:inDepthCodeReview:branch",
      "review:inDepthSpecReview:branch",
      "gate",
      "land",
      "gate",
      "handover:success",
    ]);
  });

  it("re-gates nothing when the lander lands nothing", async () => {
    const { crew, calls } = recordingCrew();

    await run(crew);

    expect(calls.filter((call) => call === "gate")).toHaveLength(1);
  });

  it("hands the handover what the lander did, rather than leaving it to infer it", async () => {
    const { crew, land } = landingCrew(landed);

    await run(crew);

    expect(land()).toEqual(landed);
  });

  it("hands the handover a refusal too, so nothing reads a block as a landing", async () => {
    const notLanded: LandResult = { kind: "not-landed", reason: "main would not fast-forward" };
    const { crew, land } = landingCrew(notLanded);

    await run(crew);

    expect(land()).toEqual(notLanded);
  });

  it("hands the handover the no landing a lander that lands nothing reported", async () => {
    const { crew, land } = recordingCrew();

    await run(crew);

    expect(land()).toEqual(NO_LANDING);
  });

  it("hands the handover no landing when a merge pass blocked before its lander ran", async () => {
    const { crew, calls, land } = landingCrew(landed, {
      async greenGate(): Promise<GateResult> {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    await run(crew);

    expect(calls).not.toContain("land");
    expect(land()).toEqual(NO_LANDING);
  });

  it("re-gates the lander's result with the resolved gate, on the run after the loop's last", async () => {
    const attempts: number[] = [];
    const { crew } = landingCrew(landed, {
      async greenGate(attempt, gate): Promise<GateResult> {
        attempts.push(attempt);
        expect(gate).toEqual(resolvedGate);
        return { green: true, detail: "green" };
      },
    });

    await run(crew);

    expect(attempts).toEqual([1, 2]);
  });

  it("numbers the re-gate after every attempt the gate loop already spent", async () => {
    const attempts: number[] = [];
    const verdicts: GateResult[] = [
      { green: false, detail: "one test red" },
      { green: true, detail: "green" },
    ];
    const { crew } = landingCrew(landed, {
      async greenGate(attempt): Promise<GateResult> {
        attempts.push(attempt);
        return verdicts.shift() ?? { green: true, detail: "green" };
      },
    });

    await run(crew);

    expect(attempts).toEqual([1, 2, 3]);
  });

  it("mid-blocks with the committed tickets when the base branch was not landed on", async () => {
    const { crew, calls, committed } = landingCrew({
      kind: "not-landed",
      reason: "main would not fast-forward",
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "main would not fast-forward" });
    expect(committed()).toEqual([ticket(1)]);
    expect(calls.at(-1)).toBe("handover:mid-block");
  });

  it("mid-blocks on a red re-gate without handing it to the fixer", async () => {
    const verdicts: GateResult[] = [
      { green: true, detail: "green" },
      { green: false, detail: "the cart tests fail once main is in" },
    ];
    const { crew, calls } = landingCrew(
      { kind: "not-landed", reason: "the cart tests fail once main is in" },
      {
        async greenGate(): Promise<GateResult> {
          calls.push("gate");
          return verdicts.shift() ?? { green: true, detail: "green" };
        },
      },
    );

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "the cart tests fail once main is in" });
    expect(calls).not.toContain("fix");
  });

  it("runs no lander when the pass never got to green", async () => {
    const { crew, calls } = landingCrew(landed, {
      async greenGate(): Promise<GateResult> {
        calls.push("gate");
        return { green: false, detail: "still red" };
      },
    });

    const outcome = await run(crew);

    expect(outcome).toEqual({ kind: "mid-block", reason: "still red" });
    expect(calls).not.toContain("land");
  });

  it("runs no lander when the planner bailed", async () => {
    const { crew, calls } = landingCrew(landed, {
      async plan(): Promise<PlanResult> {
        return { kind: "under-specified", reason: "no acceptance criteria" };
      },
    });

    await run(crew);

    expect(calls).not.toContain("land");
    expect(calls.at(-1)).toBe("handover:early-bail");
  });
});

describe("exitCodeFor", () => {
  it("maps a reviewable pass to success", () => {
    expect(exitCodeFor({ kind: "success", detail: "green" })).toBe(ExitCode.Success);
  });

  it("maps both blocked outcomes to the blocked code", () => {
    expect(exitCodeFor({ kind: "mid-block", reason: "red" })).toBe(ExitCode.Blocked);
    expect(exitCodeFor({ kind: "early-bail", reason: "thin" })).toBe(ExitCode.Blocked);
  });
});
