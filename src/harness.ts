import type { Crew, Finding, Outcome, ReviewLens, ReviewScope, TicketRef } from "./crew.js";
import { ExitCode } from "./exit-codes.js";
import type { JiraIssue } from "./jira.js";

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
 * lenses concurrently → fix, then both in-depth lenses over the whole branch
 * → fix, then the gate → fixer loop, then handover. Every exit path ends at
 * the same handover call, so no outcome can skip it.
 */
export async function runHarness(crew: Crew, issue: JiraIssue): Promise<Outcome> {
  const outcome = await runLegs(crew, issue);
  await crew.handover(outcome);
  return outcome;
}

/** The exit code an outcome ends the process with. */
export function exitCodeFor(outcome: Outcome): ExitCode {
  return outcome.kind === "success" ? ExitCode.Success : ExitCode.Blocked;
}

async function runLegs(crew: Crew, issue: JiraIssue): Promise<Outcome> {
  const plan = await crew.plan(issue);
  if (plan.kind === "under-specified") {
    return { kind: "early-bail", reason: plan.reason };
  }

  const blocked = await implementTickets(crew, plan.tickets);
  if (blocked) return blocked;

  await reviewAndFix(crew, WHOLE_BRANCH_LENSES, { kind: "branch" });
  return await driveGate(crew);
}

/**
 * Implement each ticket in the planner's order, reviewing and fixing it before
 * the next one starts. A role that wants human input stops the loop as a
 * mid-block: relay hands the baton over rather than waiting for an answer.
 */
async function implementTickets(
  crew: Crew,
  tickets: readonly TicketRef[],
): Promise<Outcome | undefined> {
  for (const ticket of tickets) {
    const result = await crew.implement(ticket);
    if (result.kind === "needs-input") {
      return { kind: "mid-block", reason: result.reason };
    }
    await reviewAndFix(crew, PER_TICKET_LENSES, { kind: "ticket", ticket });
  }
  return undefined;
}

/**
 * Run every lens of a scope concurrently and hand the merged findings to the
 * fixer. The merge is a blind concatenation — overlapping findings are the
 * fixer's to dedup, since only it can tell two phrasings of one problem apart.
 */
async function reviewAndFix(
  crew: Crew,
  lenses: readonly ReviewLens[],
  scope: ReviewScope,
): Promise<void> {
  const lensFindings = await Promise.all(lenses.map((lens) => crew.review(lens, scope)));
  const findings = lensFindings.flat();
  if (findings.length > 0) await crew.fix(findings);
}

/** Run the gate, handing each red verdict to the fixer until green or capped. */
async function driveGate(crew: Crew): Promise<Outcome> {
  let gate = await crew.qualityGate();
  for (let attempt = 0; !gate.green && attempt < MAX_GATE_FIX_ATTEMPTS; attempt++) {
    await crew.fix([gateFinding(gate.detail)]);
    gate = await crew.qualityGate();
  }
  return gate.green ? { kind: "success" } : { kind: "mid-block", reason: gate.detail };
}

function gateFinding(detail: string): Finding {
  return { source: "qualityGate", summary: detail };
}
