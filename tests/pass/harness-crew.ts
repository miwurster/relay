import {
  type Axis,
  type Crew,
  type Finding,
  type FixReport,
  type FixTarget,
  type GateResult,
  type GateVerdict,
  type ImplementResult,
  type LandResult,
  NO_LANDING,
  notGated,
  type Outcome,
  type PlanResult,
  type ResolvedGate,
  type ReviewScope,
  type TicketRef,
  type UnaddressedFinding,
} from "../../src/crew/contract.js";
import { runHarness } from "../../src/pass/harness.js";
import type { GitHubIssue } from "../../src/tracker/github.js";

/**
 * The fixtures the harness's tests share: one work item, one resolved gate, and
 * a crew of recorders standing in for every role.
 *
 * They live outside a test file because the harness's tests are split by what
 * they are about — the topology, binding findings, the re-review, `merge`
 * landing — and all four need the same crew to say anything at all.
 */
export const workItem: GitHubIssue = {
  number: 1,
  labels: ["ready-for-agent"],
  isOpen: true,
  blockedBy: [],
  subIssues: [],
};

export const resolvedGate: ResolvedGate = {
  command: "npm run verify",
  provenance: "declared",
  source: "AGENTS.md, under Verifying",
};

/**
 * The outcome of one harness run, which is what these tests are about — the rest
 * of the pass's facts are asserted where they matter, in the pass's own tests.
 */
export const run = async (crew: Crew): Promise<Outcome> =>
  (await runHarness(crew, workItem)).outcome;

export const ticket = (number: number): TicketRef => ({ number, summary: `work on #${number}` });

/** A review finding on the axis given, since the axis is what decides its weight. */
export const finding = (
  source: "ticket-review" | "branch-review" | "quality-review",
  axis: Axis,
  summary: string,
  ticket?: number,
): Finding => ({ source, axis, summary, ...(ticket ? { ticket } : {}) });

export const gateFinding = (summary: string): Finding => ({ source: "green-gate", summary });

/** A fixer that fixed everything it was handed, which is what a clean pass looks like. */
export const fixedAll = (findings: readonly Finding[]): FixReport => ({
  fixed: findings,
  skipped: [],
});

/** A fixer that declined everything it was handed, for the reason given. */
export const skippedAll = (findings: readonly Finding[], reason: string): FixReport => ({
  fixed: [],
  skipped: findings.map((f) => ({ finding: f, reason })),
});

/**
 * A two-ticket plan, for the tests about what a ticket's own review does: a
 * single-ticket plan has no per-ticket round at all.
 */
export const twoTicketPlan = {
  async plan(): Promise<PlanResult> {
    return { kind: "plan", tickets: [ticket(1), ticket(2)] };
  },
};

/** A crew that records the order of every leg, with overridable roles. */
export function recordingCrew(overrides: Partial<Crew> = {}) {
  const calls: string[] = [];
  const fixed: Finding[][] = [];
  const fixTargets: FixTarget[] = [];
  let handedOver: Outcome | undefined;
  let handedOverTickets: readonly TicketRef[] = [];
  let handedOverFinished: readonly TicketRef[] = [];
  let handedOverBlocked: readonly TicketRef[] = [];
  let handedOverLand: LandResult = NO_LANDING;
  let handedOverGate: GateVerdict = notGated(resolvedGate);
  let handedOverUnaddressed: readonly UnaddressedFinding[] = [];

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
    async review(scope: ReviewScope): Promise<Finding[]> {
      calls.push(`review:${reviewName(scope)}`);
      return [];
    },
    async fix(findings, target): Promise<FixReport> {
      calls.push("fix");
      fixed.push([...findings]);
      fixTargets.push(target);
      return fixedAll(findings);
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
    async handover(outcome, committed, finished, blocked, land, gate, unaddressed): Promise<void> {
      calls.push(`handover:${outcome.kind}`);
      handedOver = outcome;
      handedOverTickets = committed;
      handedOverFinished = finished;
      handedOverBlocked = blocked;
      handedOverLand = land;
      handedOverGate = gate;
      handedOverUnaddressed = unaddressed;
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
    finished: () => handedOverFinished,
    blocked: () => handedOverBlocked,
    land: () => handedOverLand,
    gate: () => handedOverGate,
    unaddressed: () => handedOverUnaddressed,
  };
}

/** What a scope is called in the recorded call list, re-review included. */
export function reviewName(scope: ReviewScope): string {
  switch (scope.kind) {
    case "ticket":
      return String(scope.ticket.number);
    case "branch":
      return scope.verifying ? "branch-rereview" : "branch";
    case "quality":
      return "quality";
  }
}
