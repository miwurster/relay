import type {
  Crew,
  Finding,
  FixTarget,
  LandResult,
  Outcome,
  ResolvedGate,
  ReviewLens,
  ReviewScope,
  TicketRef,
} from "../crew/contract.js";
import { ExitCode } from "../exit-codes.js";
import type { GitHubIssue } from "../tracker/github.js";

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
 * the gate → fixer loop, then the lander when the crew has one, then handover.
 * Every exit path ends at the same handover call, so no outcome can skip it.
 *
 * A multi-ticket plan is the shape that topology is for. A single-ticket plan
 * drops the fast lenses, since its one ticket is the work item and the two
 * scopes would ask the same question twice — see `perTicketLenses`.
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

  const { committed, blocked } = await implementTickets(
    crew,
    plan.tickets,
    perTicketLenses(plan.tickets),
  );
  if (blocked) return { outcome: blocked, committed };

  await reviewAndFix(crew, WHOLE_BRANCH_LENSES, { kind: "branch", workItem: issue.number });

  const { outcome, runs } = await driveGate(crew, gate);
  // A crew with no lander is a `pull-request` repo, whose pass ends here.
  if (outcome.kind !== "success" || !crew.land) return { outcome, committed };

  // The loop's verdict said nothing about what the base branch has gained since
  // it was taken, so the lander's result is gated once more — the same resolved
  // gate, numbered as the run after the loop's last.
  const landing = await crew.land(() => crew.greenGate(runs + 1, gate));
  return { outcome: outcomeOfLanding(landing), committed };
}

/**
 * What a landing attempt means for the pass. A base branch that was not landed
 * on is a `mid-block` with everything the pass committed still only on its own
 * branch — nothing landed, nothing closed, and no commit authored on the way.
 */
function outcomeOfLanding(landing: LandResult): Outcome {
  return landing.kind === "landed"
    ? { kind: "success", detail: landing.detail }
    : { kind: "mid-block", reason: landing.reason };
}

/**
 * The lenses each ticket is reviewed by once it is implemented.
 *
 * A single-ticket plan is the work item itself, so its ticket scope and the
 * branch scope are one question asked twice — the same intent, over the same
 * diff but for the fixer's own commit. The per-ticket round is the one to drop:
 * it is there to keep a bad ticket out of the tickets that follow it, and there
 * are none. The branch lenses then read strictly more, at a fuller depth, and
 * they stay what they always were — the only legs that read a fixer's commit.
 */
function perTicketLenses(tickets: readonly TicketRef[]): readonly ReviewLens[] {
  return tickets.length === 1 ? [] : PER_TICKET_LENSES;
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
  lenses: readonly ReviewLens[],
): Promise<{ committed: TicketRef[]; blocked?: Outcome }> {
  const committed: TicketRef[] = [];
  for (const ticket of tickets) {
    const result = await crew.implement(ticket);
    if (result.kind === "needs-input") {
      return { committed, blocked: { kind: "mid-block", reason: result.reason } };
    }
    committed.push(ticket);
    await reviewAndFix(crew, lenses, { kind: "ticket", ticket, base: result.base });
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
