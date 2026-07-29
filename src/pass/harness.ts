import {
  type Crew,
  type Finding,
  type FixTarget,
  type LandResult,
  NO_LANDING,
  type Outcome,
  type ResolvedGate,
  type ReviewScope,
  type TicketRef,
} from "../crew/contract.js";
import { ExitCode } from "../exit-codes.js";
import type { GitHubIssue } from "../tracker/github.js";

/**
 * How many times a red gate may be handed to the fixer. Only the objective
 * gate loops at all, and a pass that has not converged by then is worth a
 * human's time more than a third attempt.
 */
export const MAX_GATE_FIX_ATTEMPTS = 2;

/**
 * Run the pass's crew over one work item and return how it ended.
 *
 * The topology is fixed: plan once, then per ticket implement → the ticket
 * review → fix, then the whole-branch review → fix, then the gate → fixer
 * loop, then the lander, then handover.
 * Every exit path ends at the same handover call, so no outcome can skip it.
 *
 * A multi-ticket plan is the shape that topology is for. A single-ticket plan
 * drops the per-ticket review, since its one ticket is the work item and the
 * two scopes would ask the same question twice — see `reviewsEachTicket`.
 */
export async function runHarness(crew: Crew, issue: GitHubIssue): Promise<Outcome> {
  const { outcome, committed, land } = await runLegs(crew, issue);
  await crew.handover(outcome, committed, land);
  return outcome;
}

/** The exit code an outcome ends the process with. */
export function exitCodeFor(outcome: Outcome): ExitCode {
  return outcome.kind === "success" ? ExitCode.Success : ExitCode.Blocked;
}

/** How the legs ended, and the tickets the branch carries by then. */
interface LegsResult {
  outcome: Outcome;
  committed: TicketRef[];
  /** What the lander did, or no landing at all when the legs never reached it. */
  land: LandResult;
}

async function runLegs(crew: Crew, issue: GitHubIssue): Promise<LegsResult> {
  // Resolved once per pass, ahead of the planner, so the same command answers
  // every attempt of the gate loop below — and so even a pass the planner bails
  // on has read the repo's docs for its gate.
  const gate: ResolvedGate = await crew.resolveGate();

  const plan = await crew.plan(issue);
  if (plan.kind === "under-specified") {
    return {
      outcome: { kind: "early-bail", reason: plan.reason },
      committed: [],
      land: NO_LANDING,
    };
  }

  const { committed, blocked } = await implementTickets(
    crew,
    plan.tickets,
    reviewsEachTicket(plan.tickets),
  );
  if (blocked) return { outcome: blocked, committed, land: NO_LANDING };

  await reviewAndFix(crew, { kind: "branch", workItem: issue.number });

  const { outcome, runs } = await driveGate(crew, gate);
  // Only a green branch is worth landing, so a blocked pass never asks.
  if (outcome.kind !== "success") return { outcome, committed, land: NO_LANDING };

  // The loop's verdict said nothing about what the base branch has gained since
  // it was taken, so the lander's result is gated once more — the same resolved
  // gate, numbered as the run after the loop's last.
  const land = await crew.land(() => crew.greenGate(runs + 1, gate));
  // A base branch that was meant to be landed on and was not is a `mid-block`
  // with everything the pass committed still only on its own branch — nothing
  // landed, nothing closed. Anything else leaves the gate loop's verdict as the
  // outcome: the gate is what verified what landed, and the lander's own story
  // travels beside it.
  return {
    outcome: land.kind === "not-landed" ? { kind: "mid-block", reason: land.reason } : outcome,
    committed,
    land,
  };
}

/**
 * Whether each ticket is reviewed as it is implemented.
 *
 * A single-ticket plan is the work item itself, so its ticket scope and the
 * branch scope are one question asked twice — the same intent, over the same
 * diff but for the fixer's own commit. The per-ticket round is the one to drop:
 * it is there to keep a bad ticket out of the tickets that follow it, and there
 * are none. The branch review then reads strictly more, and it stays what it
 * always was — the only review that reads a fixer's commit.
 */
function reviewsEachTicket(tickets: readonly TicketRef[]): boolean {
  return tickets.length > 1;
}

/**
 * Implement each ticket in the planner's order, reviewing and fixing it before
 * the next one starts. A role that wants human input stops the loop as a
 * mid-block: relay hands the baton over rather than waiting for an answer, with
 * whatever the earlier tickets already committed.
 */
async function implementTickets(
  crew: Crew,
  tickets: readonly TicketRef[],
  reviewEachTicket: boolean,
): Promise<{ committed: TicketRef[]; blocked?: Outcome }> {
  const committed: TicketRef[] = [];
  for (const ticket of tickets) {
    const result = await crew.implement(ticket);
    if (result.kind === "needs-input") {
      return { committed, blocked: { kind: "mid-block", reason: result.reason } };
    }
    committed.push(ticket);
    if (reviewEachTicket) {
      await reviewAndFix(crew, { kind: "ticket", ticket, base: result.base });
    }
  }
  return { committed };
}

/** Review one scope and hand whatever it wants changed to the fixer. */
async function reviewAndFix(crew: Crew, scope: ReviewScope): Promise<void> {
  const findings: Finding[] = await crew.review(scope);
  if (findings.length > 0) await crew.fix(findings, fixTargetFor(scope));
}

function fixTargetFor(scope: ReviewScope): FixTarget {
  return scope.kind === "ticket" ? { kind: "ticket", ticket: scope.ticket } : { kind: "branch" };
}

/** How the gate loop ended, and how many gate runs it took to get there. */
interface GateLoop {
  outcome: Outcome;
  /** How many gate runs it took, which is what a later run has to number after. */
  runs: number;
}

/** Run the gate, handing each red verdict to the fixer until green or capped. */
async function driveGate(crew: Crew, gate: ResolvedGate): Promise<GateLoop> {
  let result = await crew.greenGate(1, gate);
  let runs = 1;
  for (let attempt = 1; !result.green && attempt <= MAX_GATE_FIX_ATTEMPTS; attempt++) {
    await crew.fix([gateFinding(result.detail)], { kind: "gate", attempt });
    result = await crew.greenGate(attempt + 1, gate);
    runs++;
  }
  return {
    outcome: result.green
      ? { kind: "success", detail: result.detail }
      : { kind: "mid-block", reason: result.detail },
    runs,
  };
}

function gateFinding(detail: string): Finding {
  return { source: "greenGate", summary: detail };
}
