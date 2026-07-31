import {
  type BranchAxes,
  type Crew,
  type Finding,
  type FixReport,
  type FixTarget,
  isBinding,
  type LandResult,
  NO_LANDING,
  type Outcome,
  type ResolvedGate,
  type ReviewScope,
  type TicketRef,
  type UnaddressedFinding,
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
 * Why a finding the re-review raised was left where it was.
 *
 * The re-review runs after the only fixer leg the branch scope gets, so there is
 * nobody left to hand its findings to. That is the design, not an oversight
 * ([ADR-0022](../../docs/adr/0022-a-fix-is-verified-once.md)) — but it is still a
 * finding nobody acted on, so it is reported as one.
 */
const REREVIEW_REASON =
  "the re-review raised it over the fixer's own commit, and a re-review's findings reach no fixer";

/**
 * Run the pass's crew over one work item and return how it ended.
 *
 * The topology is fixed: plan once, then per ticket implement → the ticket
 * review → fix, then the whole-branch review → fix → its one re-review,
 * then the quality review → fix, then the gate → fixer loop, then the lander,
 * then handover.
 * Every exit path ends at the same handover call, so no outcome can skip it.
 *
 * A multi-ticket plan is the shape that topology is for. A single-ticket plan
 * drops the per-ticket review, since its one ticket is the work item and the
 * two scopes would ask the same question twice — see `reviewsEachTicket` — and
 * its branch review is asked for `standards` as well as `spec`, because the
 * review that would have read that axis is the one just dropped.
 */
export async function runHarness(crew: Crew, issue: GitHubIssue): Promise<Outcome> {
  const { outcome, committed, blockedOn, land, unaddressed } = await runLegs(crew, issue);
  const { finished, blocked } = ticketState(committed, unaddressed, blockedOn);
  await crew.handover(outcome, committed, finished, blocked, land, unaddressed);
  return outcome;
}

/** Which tickets the pass earned a done for, and which one a human has to decide about. */
interface TicketState {
  finished: TicketRef[];
  blocked: TicketRef[];
}

/**
 * Split what the pass touched into the tickets it earned a done for and the
 * tickets it left for a human.
 *
 * Finished is committed, minus any ticket carrying a binding finding nobody
 * addressed. A ticket counts as committed the moment its implementer returns,
 * before its review runs, so a blocked pass's committed tickets include the one
 * it blocked on. Both lists are the harness's own fact rather than a leg's
 * judgement, so no prompt has to work out which of the committed tickets it may
 * claim done about.
 *
 * Binding, not any finding: a pass lands with its `standards` and `quality`
 * findings overridden, so excluding those tickets would leave landed work
 * unclosed. It is the same predicate `blockFor` blocks on, so the lists and the
 * block cannot disagree about which ticket went unbuilt.
 *
 * A binding finding at branch scope names no ticket, and so finishes none: the
 * review said the branch does not do what the item asked without saying which
 * ticket is at fault, and ticking every committed ticket would claim a done the
 * pass did not earn. The whole branch is what a human then has to decide about.
 *
 * `blockedOn` is the ticket an implementer asked for a human over, which never
 * reached the committed list at all — it is blocked without ever having been
 * finishable.
 */
function ticketState(
  committed: readonly TicketRef[],
  unaddressed: readonly UnaddressedFinding[],
  blockedOn?: TicketRef,
): TicketState {
  const binding = unaddressed.filter(({ finding }) => isBinding(finding));
  const unbuilt = new Set(binding.map(({ finding }) => ticketOf(finding)));
  const branchWide = binding.some(({ finding }) => ticketOf(finding) === undefined);

  const finished = branchWide ? [] : committed.filter((ticket) => !unbuilt.has(ticket.number));
  const done = new Set(finished.map((ticket) => ticket.number));
  return {
    finished,
    blocked: [
      ...committed.filter((ticket) => !done.has(ticket.number)),
      ...(blockedOn ? [blockedOn] : []),
    ],
  };
}

/** Which ticket a finding is about, if it is about one rather than the branch. */
function ticketOf(finding: Finding): number | undefined {
  return finding.source === "green-gate" ? undefined : finding.ticket;
}

/** The exit code an outcome ends the process with. */
export function exitCodeFor(outcome: Outcome): ExitCode {
  return outcome.kind === "success" ? ExitCode.Success : ExitCode.Blocked;
}

/** How the legs ended, and the tickets the branch carries by then. */
interface LegsResult {
  outcome: Outcome;
  committed: TicketRef[];
  /**
   * The ticket an implementer asked for a human over, which is why it never
   * reached `committed`. Absent on every other path.
   */
  blockedOn?: TicketRef;
  /** What the lander did, or no landing at all when the legs never reached it. */
  land: LandResult;
  /** Every finding nobody acted on, in the order the legs that produced it ran. */
  unaddressed: UnaddressedFinding[];
}

async function runLegs(crew: Crew, issue: GitHubIssue): Promise<LegsResult> {
  // Resolved once per pass, ahead of the planner, so the same command answers
  // every attempt of the gate loop below — and so even a pass the planner bails
  // on has read the repo's docs for its gate.
  const gate: ResolvedGate = await crew.resolveGate();

  // What the pass has to show for itself, as each leg fills it in. Nothing has
  // landed until the lander says so, which is why `no-landing` is the default
  // rather than a fact every exit short of the lander has to restate.
  const progress: Omit<LegsResult, "outcome"> = {
    committed: [],
    land: NO_LANDING,
    unaddressed: [],
  };

  const plan = await crew.plan(issue);
  if (plan.kind === "under-specified") {
    return { ...progress, outcome: { kind: "early-bail", reason: plan.reason } };
  }

  const reviewEachTicket = reviewsEachTicket(plan.tickets);
  const tickets = await implementTickets(crew, plan.tickets, reviewEachTicket);
  progress.committed = tickets.committed;
  progress.blockedOn = tickets.blockedOn;
  progress.unaddressed.push(...tickets.unaddressed);
  if (tickets.blocked) return { ...progress, outcome: tickets.blocked };

  // One fact, both ways round: the per-ticket review is what reads `standards`,
  // so the branch review takes that axis exactly when no ticket review ran.
  const branch = await reviewBranch(crew, issue.number, reviewEachTicket ? "spec" : "both");
  progress.unaddressed.push(...branch.unaddressed);
  if (branch.blocked) return { ...progress, outcome: branch.blocked };

  // Only now: the branch does what the item asked, so what is left to ask is
  // whether it is worth keeping. A branch that just took a spec fix is the most
  // likely to be structurally messy, which is why this runs after the fix rather
  // than only over a review that was clean first time.
  //
  // Nothing here can block, and there is no re-review: a `quality` finding is not
  // binding, and a fix is verified once
  // ([ADR-0022](../../docs/adr/0022-a-fix-is-verified-once.md)). What the fixer
  // declined is reported so a human knows a role overrode a call about their code.
  const quality = await reviewAndFix(crew, { kind: "quality", workItem: issue.number });
  progress.unaddressed.push(...quality.skipped);

  const loop = await driveGate(crew, gate);
  progress.unaddressed.push(...loop.unaddressed);
  // Only a green branch is worth landing, so a blocked pass never asks.
  if (loop.outcome.kind !== "success") return { ...progress, outcome: loop.outcome };

  // The loop's verdict said nothing about what the base branch has gained since
  // it was taken, so the lander's result is gated once more — the same resolved
  // gate, numbered as the run after the loop's last.
  const land = await crew.land(() => crew.greenGate(loop.runs + 1, gate));
  // A base branch that was meant to be landed on and was not is a `mid-block`
  // with everything the pass committed still only on its own branch — nothing
  // landed, nothing closed. Anything else leaves the gate loop's verdict as the
  // outcome: the gate is what verified what landed, and the lander's own story
  // travels beside it.
  return {
    ...progress,
    land,
    outcome: land.kind === "not-landed" ? { kind: "mid-block", reason: land.reason } : loop.outcome,
  };
}

/**
 * Whether each ticket is reviewed as it is implemented.
 *
 * A single-ticket plan is the work item itself, so its ticket scope and the
 * branch scope are one question asked twice — the same intent, over the same
 * diff but for the fixer's own commit. The per-ticket round is the one to drop:
 * it is there to keep a bad ticket out of the tickets that follow it, and there
 * are none. The branch review then reads that same diff on both axes, and it
 * stays what it always was — the only review that reads a fixer's commit
 * ([ADR-0031](../../docs/adr/0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md)).
 */
function reviewsEachTicket(tickets: readonly TicketRef[]): boolean {
  return tickets.length > 1;
}

/**
 * What one stage of the topology left behind: findings nobody acted on, and any
 * block they earn. Every stage below reports this shape, which is what lets
 * `runLegs` treat them alike.
 */
interface StageResult {
  unaddressed: UnaddressedFinding[];
  blocked?: Outcome;
}

/** What the ticket loop got through, plus whatever stopped it. */
interface TicketsResult extends StageResult {
  committed: TicketRef[];
  /** The ticket an implementer asked for a human over, when one did. */
  blockedOn?: TicketRef;
}

/**
 * Implement each ticket in the planner's order, reviewing and fixing it before
 * the next one starts. A role that wants human input stops the loop as a
 * mid-block: relay hands the baton over rather than waiting for an answer, with
 * whatever the earlier tickets already committed.
 *
 * A binding finding the fixer declined stops the loop the same way, and at the
 * ticket it was declined on: the tickets after it would be built on a change
 * already known not to do what was asked, and under `merge` landing that walks
 * all the way to the lander's door before anyone finds out.
 */
async function implementTickets(
  crew: Crew,
  tickets: readonly TicketRef[],
  reviewEachTicket: boolean,
): Promise<TicketsResult> {
  const committed: TicketRef[] = [];
  const unaddressed: UnaddressedFinding[] = [];
  for (const ticket of tickets) {
    const result = await crew.implement(ticket);
    if (result.kind === "needs-input") {
      // Named rather than only counted as absent: it carries the hold its
      // implementer applied, and the handover is the leg that has to say so.
      return {
        committed,
        unaddressed,
        blockedOn: ticket,
        blocked: { kind: "mid-block", reason: result.reason },
      };
    }
    committed.push(ticket);
    if (!reviewEachTicket) continue;

    const report = await reviewAndFix(crew, { kind: "ticket", ticket, base: result.base });
    unaddressed.push(...report.skipped);
    const blocked = blockFor(report.skipped);
    if (blocked) return { committed, unaddressed, blocked };
  }
  return { committed, unaddressed };
}

/**
 * The whole-branch review, its fix, and — only when that fix changed something —
 * one re-review over the fixer's own commit.
 *
 * That re-review is the pass's only look at a fix nobody else reads. The gate
 * that runs next is objective, so without it a spec fix could address the wrong
 * half of what the item asked and still land green. It runs exactly once, and
 * its findings reach no fixer: a loop here is the runaway relay refuses to be
 * ([ADR-0022](../../docs/adr/0022-a-fix-is-verified-once.md)).
 */
async function reviewBranch(crew: Crew, workItem: number, axes: BranchAxes): Promise<StageResult> {
  const report = await reviewAndFix(crew, { kind: "branch", workItem, axes, rereview: false });
  const declined = report.skipped;
  const blocked = blockFor(declined);
  if (blocked) return { unaddressed: [...declined], blocked };
  // Nothing changed, so there is nothing new to read: a review that found
  // nothing, or a fixer that declined all of it, has already been accounted for.
  if (report.fixed.length === 0) return { unaddressed: [...declined] };

  // The same axes as the first run: the re-review is that review again, and a
  // second run asked less would leave the axis it dropped unread on the one
  // commit nobody else looks at.
  const findings = await crew.review({ kind: "branch", workItem, axes, rereview: true });
  const raised = findings.map((finding) => ({ finding, reason: REREVIEW_REASON }));
  // Only the re-review's own findings can block from here: whatever the fixer
  // declined was already judged above, and it did not.
  return { unaddressed: [...declined, ...raised], blocked: blockFor(raised) };
}

/**
 * The block a binding finding nobody addressed earns the pass.
 *
 * This is the whole of what `binding` costs, in one place: the fixer may decline
 * to act on a finding, but not to account for it, and relay stops rather than
 * land a branch that does not do what the item asked
 * ([ADR-0021](../../docs/adr/0021-spec-findings-are-binding.md)).
 */
function blockFor(unaddressed: readonly UnaddressedFinding[]): Outcome | undefined {
  const binding = unaddressed.filter(({ finding }) => isBinding(finding));
  if (binding.length === 0) return undefined;

  const detail = binding.map(({ finding, reason }) => `${finding.summary} — ${reason}`).join("; ");
  return {
    kind: "mid-block",
    reason: `the branch does not do what the item asked, and nobody addressed it: ${detail}`,
  };
}

/** Review one scope and hand whatever it wants changed to the fixer. */
async function reviewAndFix(crew: Crew, scope: ReviewScope): Promise<FixReport> {
  const findings: Finding[] = await crew.review(scope);
  if (findings.length === 0) return { fixed: [], skipped: [] };
  return await crew.fix(findings, fixTargetFor(scope));
}

function fixTargetFor(scope: ReviewScope): FixTarget {
  switch (scope.kind) {
    case "ticket":
      return { kind: "ticket", ticket: scope.ticket };
    case "branch":
      return { kind: "branch" };
    case "quality":
      return { kind: "quality" };
  }
}

/** How the gate loop ended, and how many gate runs it took to get there. */
interface GateLoop {
  outcome: Outcome;
  /** How many gate runs it took, which is what a later run has to number after. */
  runs: number;
  /** The gate findings the fixer declined, which are reported but never block. */
  unaddressed: UnaddressedFinding[];
}

/**
 * Run the gate, handing each red verdict to the fixer until green or capped.
 *
 * A gate finding needs no binding rule of its own: a gate the fixer declined
 * stays red, and the cap below is what blocks. Its declines are still reported,
 * because a fixer that talked its way past a red gate that then went green on
 * its own is worth a human knowing about.
 */
async function driveGate(crew: Crew, gate: ResolvedGate): Promise<GateLoop> {
  let result = await crew.greenGate(1, gate);
  let runs = 1;
  const unaddressed: UnaddressedFinding[] = [];
  for (let attempt = 1; !result.green && attempt <= MAX_GATE_FIX_ATTEMPTS; attempt++) {
    const report = await crew.fix([gateFinding(result.detail)], { kind: "gate", attempt });
    unaddressed.push(...report.skipped);
    result = await crew.greenGate(attempt + 1, gate);
    runs++;
  }
  return {
    outcome: result.green
      ? { kind: "success", detail: result.detail }
      : { kind: "mid-block", reason: result.detail },
    runs,
    unaddressed,
  };
}

function gateFinding(detail: string): Finding {
  return { source: "green-gate", summary: detail };
}
