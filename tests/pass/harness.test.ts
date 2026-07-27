import { describe, expect, it } from "vitest";
import type {
  Crew,
  Finding,
  FixTarget,
  GateResult,
  ImplementResult,
  Outcome,
  PlanResult,
  ResolvedGate,
  ReviewLens,
  ReviewScope,
  TicketRef,
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

/** A crew that records the order of every leg, with overridable roles. */
function recordingCrew(overrides: Partial<Crew> = {}) {
  const calls: string[] = [];
  const fixed: Finding[][] = [];
  const fixTargets: FixTarget[] = [];
  let handedOver: Outcome | undefined;
  let handedOverTickets: readonly TicketRef[] = [];

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
    async handover(outcome, committed): Promise<void> {
      calls.push(`handover:${outcome.kind}`);
      handedOver = outcome;
      handedOverTickets = committed;
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
  };
}

describe("runHarness", () => {
  it("runs the full topology in order: plan, per-ticket loop, branch review, gate, handover", async () => {
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
      "review:fastCodeReview:1",
      "review:fastSpecReview:1",
      "implement:2",
      "review:fastCodeReview:2",
      "review:fastSpecReview:2",
      "review:inDepthCodeReview:branch",
      "review:inDepthSpecReview:branch",
      "gate",
      "handover:success",
    ]);
  });

  it("runs the lenses of a scope one at a time, since they share one worktree", async () => {
    const events: string[] = [];

    const { crew } = recordingCrew({
      async review(lens: ReviewLens) {
        events.push(`start:${lens}`);
        await Promise.resolve();
        events.push(`end:${lens}`);
        return [];
      },
    });

    await run(crew);

    expect(events).toEqual([
      "start:fastCodeReview",
      "end:fastCodeReview",
      "start:fastSpecReview",
      "end:fastSpecReview",
      "start:inDepthCodeReview",
      "end:inDepthCodeReview",
      "start:inDepthSpecReview",
      "end:inDepthSpecReview",
    ]);
  });

  it("array-merges both lenses' findings into one fixer call", async () => {
    const { crew, fixed } = recordingCrew({
      async review(lens, scope) {
        if (scope.kind !== "ticket") return [];
        return [finding(lens, "same problem", scope.ticket.number)];
      },
    });

    await run(crew);

    expect(fixed[0]).toEqual([
      finding("fastCodeReview", "same problem", 1),
      finding("fastSpecReview", "same problem", 1),
    ]);
  });

  it("tells each fixer leg what it is fixing", async () => {
    const { crew, fixTargets } = recordingCrew({
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
      { kind: "branch" },
      { kind: "gate", attempt: 1 },
      { kind: "gate", attempt: 2 },
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
