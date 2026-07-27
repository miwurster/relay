import type {
  Crew,
  Finding,
  FixTarget,
  Outcome,
  ResolvedGate,
  ReviewLens,
  ReviewScope,
  TicketRef,
} from "./crew.js";
import { ExitCode } from "./exit-codes.js";
import type { GitHubIssue } from "./github.js";

/** The lenses that read one ticket's change, right after it was implemented. */
const PER_TICKET_LENSES: ReviewLens[] = ["fastCodeReview", "fastSpecReview"];

/** The lenses that read the whole branch, once, after the last ticket. */
const WHOLE_BRANCH_LENSES: ReviewLens[] = ["inDepthCodeReview", "inDepthSpecReview"];

/**
 * How many times a red gate may be handed to the fixer. Only the objective
 * gate loops at all, and a pass that has not converged by then is worth a
 * human's time more than a third attempt.
 */
export const MAX_GATE_FIX_ATTEMPTS = 2;

/**
 * Run the pass's crew over one work item and return how it ended.
 *
 * The topology is fixed: plan once, then per ticket implement → both fast
 * lenses → fix, then both in-depth lenses over the whole branch → fix, then
 * the gate → fixer loop, then handover. Every exit path ends at the same
 * handover call, so no outcome can skip it.
 */
export async function runHarness(crew: Crew, issue: GitHubIssue): Promise<Outcome> {
  const { outcome, committed } = await runLegs(crew, issue);
  await crew.handover(outcome, committed);
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
}

async function runLegs(crew: Crew, issue: GitHubIssue): Promise<LegsResult> {
  // Resolved once per pass, ahead of the planner, so the same command answers
  // every attempt of the gate loop below — and so even a pass the planner bails
  // on has read the repo's docs for its gate.
  const gate: ResolvedGate = await crew.resolveGate();

  const plan = await crew.plan(issue);
  if (plan.kind === "under-specified") {
    return { outcome: { kind: "early-bail", reason: plan.reason }, committed: [] };
  }

  const { committed, blocked } = await implementTickets(crew, plan.tickets);
  if (blocked) return { outcome: blocked, committed };

  await reviewAndFix(crew, WHOLE_BRANCH_LENSES, { kind: "branch", workItem: issue.number });
  return { outcome: await driveGate(crew, gate), committed };
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
): Promise<{ committed: TicketRef[]; blocked?: Outcome }> {
  const committed: TicketRef[] = [];
  for (const ticket of tickets) {
    const result = await crew.implement(ticket);
    if (result.kind === "needs-input") {
      return { committed, blocked: { kind: "mid-block", reason: result.reason } };
    }
    committed.push(ticket);
    await reviewAndFix(crew, PER_TICKET_LENSES, { kind: "ticket", ticket, base: result.base });
  }
  return { committed };
}

/**
 * Run every lens of a scope and hand the merged findings to the fixer. The
 * merge is a blind concatenation — overlapping findings are the fixer's to
 * dedup, since only it can tell two phrasings of one problem apart.
 *
 * The lenses run one after another, not together. They are independent reads
 * and would happily run in parallel, but the whole crew shares one sandbox and
 * therefore one git worktree: each leg takes a HEAD baseline before it starts
 * and detaches, merges and deletes its branch afterwards, so two legs at once
 * race on the same refs and misattribute each other's commits.
 */
async function reviewAndFix(
  crew: Crew,
  lenses: readonly ReviewLens[],
  scope: ReviewScope,
): Promise<void> {
  const findings: Finding[] = [];
  for (const lens of lenses) findings.push(...(await crew.review(lens, scope)));
  if (findings.length > 0) await crew.fix(findings, fixTargetFor(scope));
}

function fixTargetFor(scope: ReviewScope): FixTarget {
  return scope.kind === "ticket" ? { kind: "ticket", ticket: scope.ticket } : { kind: "branch" };
}

/** Run the gate, handing each red verdict to the fixer until green or capped. */
async function driveGate(crew: Crew, gate: ResolvedGate): Promise<Outcome> {
  let result = await crew.greenGate(1, gate);
  for (let attempt = 1; !result.green && attempt <= MAX_GATE_FIX_ATTEMPTS; attempt++) {
    await crew.fix([gateFinding(result.detail)], { kind: "gate", attempt });
    result = await crew.greenGate(attempt + 1, gate);
  }
  return result.green
    ? { kind: "success", detail: result.detail }
    : { kind: "mid-block", reason: result.detail };
}

function gateFinding(detail: string): Finding {
  return { source: "greenGate", summary: detail };
}
