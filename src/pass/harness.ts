import {
  type BranchAxes,
  type Crew,
  type Finding,
  findingLabel,
  type FixReport,
  type FixTarget,
  type GateResult,
  type GateVerdict,
  isBinding,
  type LandResult,
  NO_LANDING,
  notGated,
  type Outcome,
  type PassFacts,
  type ResolvedGate,
  type ReviewScope,
  type TicketRef,
  type UnaddressedFinding,
} from "../crew/contract.js";
import { RoleError } from "../errors.js";
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
  "the re-review found the fixer's commit does not address it, and a re-review's findings reach no fixer";

/**
 * Why a finding the quality fixer was handed was left where it was.
 *
 * A quality fixer that fails to answer decided nothing about the findings it was
 * handed, and `quality` is not an axis anything may stop a pass on
 * ([ADR-0036](../../docs/adr/0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md))
 * — so they are reported as unaddressed rather than blocking. A weaker signal
 * than a fixer that declined with a reason, and named as one.
 */
const QUALITY_FIXER_NO_ANSWER_REASON =
  "the quality fixer failed to answer, so nothing it was handed was decided";

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
 * drops the per-ticket review, since there is no ticket after it to protect, and
 * its branch review is asked for `standards` as well as `spec`, because the
 * review that would have read that axis is the one just dropped
 * ([ADR-0031](../../docs/adr/0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md)).
 * It drops the quality review too, since that branch review is then already
 * reading the structural question over the same diff
 * ([ADR-0037](../../docs/adr/0037-the-quality-review-runs-only-on-a-multi-ticket-plan.md)).
 */
export async function runHarness(crew: Crew, workItem: GitHubIssue): Promise<PassFacts> {
  const { outcome, committed, blockedOn, land, gate, unaddressed } = await runLegs(crew, workItem);
  const { finished, blocked } = ticketState(committed, unaddressed, blockedOn);
  await crew.handover(outcome, committed, finished, blocked, land, gate, unaddressed);
  // The same facts the handover was told, answered rather than only spoken: they
  // are what the pass record holds, and nothing on disk holds them otherwise
  // ([ADR-0035](../../docs/adr/0035-a-pass-records-its-own-facts.md)).
  return { outcome, gate, land, committed, finished, blocked, unaddressed };
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
  /** What the gate said, or that the legs blocked before it ran. */
  gate: GateVerdict;
  /** Every finding nobody acted on, in the order the legs that produced it ran. */
  unaddressed: UnaddressedFinding[];
}

/**
 * What the pass has to show for itself so far, filled in by each leg as it
 * answers rather than assembled from what the stages returned.
 *
 * As it goes, because a leg that fails to answer stops its stage mid-way: the
 * tickets already committed and the findings already left are facts the block has
 * to carry, and a stage that returned nothing cannot hand them over
 * ([ADR-0036](../../docs/adr/0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md)).
 */
type PassProgress = Omit<LegsResult, "outcome">;

/**
 * Run the legs, and turn a leg that failed to answer into a block rather than a
 * crash.
 *
 * A `RoleError` is a leg that ran and did not deliver a usable answer, after the
 * one retry it gets ([ADR-0033](../../docs/adr/0033-a-protocol-slip-gets-one-retry.md)).
 * That is a pass a human has to look at, but it is not a crash: relay knows what
 * happened, and the pass has committed tickets, findings and a gate verdict to
 * report. So it becomes a `mid-block` carrying the error's own sentence, with
 * whatever `progress` had by then, and takes the ordinary blocked path — the
 * handover runs, the labels are swapped, the branch is pushed
 * ([ADR-0036](../../docs/adr/0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md)).
 *
 * Deliberately inside the legs and outside the handover call, which is why the
 * conversion is here rather than in `runHarness`: a handover that fails to
 * answer is still a crash, because it is the leg that would have reported the
 * block and there is nothing left to hand the work to.
 *
 * The gate resolver is outside it too, for a narrower reason: it is what supplies
 * the `ResolvedGate` every `GateVerdict` carries, so a pass that never got one
 * has no gate verdict to state and nothing to report the block with.
 */
async function runLegs(crew: Crew, workItem: GitHubIssue): Promise<LegsResult> {
  // Resolved once per pass, ahead of the planner, so the same command answers
  // every attempt of the gate loop below — and so even a pass the planner bails
  // on has read the repo's docs for its gate.
  const resolvedGate: ResolvedGate = await crew.resolveGate();

  // What the pass has to show for itself, as each leg fills it in. Nothing has
  // landed and nothing is verified until the legs that do so say so, which is why
  // `no-landing` and `not-gated` are the defaults rather than facts every exit
  // short of those legs has to restate.
  const progress: PassProgress = {
    committed: [],
    land: NO_LANDING,
    gate: notGated(resolvedGate),
    unaddressed: [],
  };

  try {
    // The outcome first, then the facts: `progress` is read after the legs have
    // filled it in, never in the same expression that is still waiting on them.
    const outcome = await runTopology(crew, workItem, resolvedGate, progress);
    return { ...progress, outcome };
  } catch (error) {
    if (!(error instanceof RoleError)) throw error;
    return { ...progress, outcome: { kind: "mid-block", reason: error.message } };
  }
}

/**
 * The pass's legs in order, filling `progress` in as each one answers, so a leg
 * that fails to answer leaves its caller holding everything the pass got through.
 *
 * It answers with the outcome alone: every fact a pass has to show for itself is
 * in `progress` by the time it returns, so its caller is the one place those two
 * halves are put together and no exit path here can compose a different pair.
 */
async function runTopology(
  crew: Crew,
  workItem: GitHubIssue,
  resolvedGate: ResolvedGate,
  progress: PassProgress,
): Promise<Outcome> {
  const plan = await crew.plan(workItem);
  if (plan.kind === "under-specified") {
    return { kind: "early-bail", reason: plan.reason };
  }

  // The one fact three of the legs below turn on, and the shape the topology is
  // for: the per-ticket round exists to keep a bad ticket out of the tickets that
  // follow it, and a one-ticket plan has none. That holds however the plan came to
  // have one ticket — whether the work item had no sub-issues and became the
  // ticket itself, or a human filed exactly one.
  const multiTicket = plan.tickets.length > 1;

  const tickets = await implementTickets(crew, plan.tickets, multiTicket, progress);
  if (tickets.blocked) return tickets.blocked;

  // One fact, both ways round: the per-ticket review is what reads `standards`,
  // so the branch review takes that axis exactly when no ticket review ran
  // ([ADR-0031](../../docs/adr/0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md)).
  const branch = await reviewBranch(crew, workItem.number, multiTicket ? "spec" : "both", progress);
  if (branch.blocked) return branch.blocked;

  // Only now: the branch does what the item asked, so what is left to ask is
  // whether it is worth keeping. A branch that just took a spec fix is the most
  // likely to be structurally messy, which is why this runs after the fix rather
  // than only over a review that was clean first time.
  //
  // Where no ticket review ran, the branch review above already read `standards`
  // over this very diff, so a single-ticket pass goes straight to the gate
  // ([ADR-0037](../../docs/adr/0037-the-quality-review-runs-only-on-a-multi-ticket-plan.md)).
  //
  // Nothing here can block — not a finding, and not a leg that fails to answer
  // — and there is no re-review: a `quality` finding is not binding, and a fix is
  // verified once ([ADR-0022](../../docs/adr/0022-a-fix-is-verified-once.md)).
  // What the fixer declined is reported so a human knows a role overrode a call
  // about their code.
  //
  // It is handed everything the pass's earlier fixers changed code for, so the
  // one review that reads the branch last cannot order the reversal of a fix an
  // earlier review ordered without knowing it is doing so
  // ([ADR-0034](../../docs/adr/0034-the-quality-review-is-told-what-the-pass-already-settled.md)).
  if (multiTicket) {
    await reviewQuality(crew, workItem.number, [...tickets.fixed, ...branch.fixed], progress);
  }

  // It writes each run's verdict into `progress` as that run answers, so a fixer
  // that fails to answer mid-loop still hands over the red verdict that was
  // already reached rather than claiming the gate never ran.
  const loop = await driveGate(crew, resolvedGate, progress);
  // Only a green branch is worth landing, so a blocked pass never asks.
  if (loop.outcome.kind !== "success") return loop.outcome;

  // The loop's verdict said nothing about what the base branch has gained since
  // it was taken, so the lander's result is gated once more — the same resolved
  // gate, numbered as the run after the loop's last.
  const land = await crew.land(() => crew.greenGate(loop.runs + 1, resolvedGate));
  progress.land = land;
  // A base branch that was meant to be landed on and was not is a `mid-block`
  // with everything the pass committed still only on its own branch — nothing
  // landed, nothing closed. Anything else leaves the gate loop's verdict as the
  // outcome: the gate is what verified what landed, and the lander's own story
  // travels beside it.
  return land.kind === "not-landed" ? { kind: "mid-block", reason: land.reason } : loop.outcome;
}

/**
 * What one stage of the topology answers with. The findings it left unaddressed
 * are not here: a stage writes those into `PassProgress` as it produces them, so
 * a leg that fails to answer part-way through does not take them with it.
 */
interface StageResult {
  /**
   * The findings this stage's fixer changed code for, which travel to the
   * quality review as the decisions already on the branch
   * ([ADR-0034](../../docs/adr/0034-the-quality-review-is-told-what-the-pass-already-settled.md)).
   */
  fixed: readonly Finding[];
  blocked?: Outcome;
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
  progress: PassProgress,
): Promise<StageResult> {
  const fixed: Finding[] = [];
  for (const ticket of tickets) {
    const result = await crew.implement(ticket);
    if (result.kind === "needs-input") {
      // Named rather than only counted as absent: it carries the hold its
      // implementer applied, and the handover is the leg that has to say so.
      progress.blockedOn = ticket;
      return { fixed, blocked: { kind: "mid-block", reason: result.reason } };
    }
    progress.committed.push(ticket);
    if (!reviewEachTicket) continue;

    const report = await reviewAndFix(crew, { kind: "ticket", ticket, base: result.base });
    progress.unaddressed.push(...report.skipped);
    fixed.push(...report.fixed);
    const blocked = blockFor(report.skipped);
    if (blocked) return { fixed, blocked };
  }
  return { fixed };
}

/**
 * The whole-branch review, its fix, and — only when that fix changed something —
 * one re-review of what that fix claimed.
 *
 * That re-review is the pass's only look at a fix nobody else reads. The gate
 * that runs next is objective, so without it a spec fix could address the wrong
 * half of what the item asked and still land green. It runs exactly once, and
 * its findings reach no fixer: a loop here is the runaway relay refuses to be
 * ([ADR-0022](../../docs/adr/0022-a-fix-is-verified-once.md)).
 *
 * It is handed the findings the fixer said it fixed, and asks only whether the
 * branch now satisfies them. A second full read of the branch would find its
 * first new findings in the fixer's own commit — code no earlier review saw —
 * and those reach nobody, so a binding one would block every pass whose fix
 * touched anything
 * ([ADR-0032](../../docs/adr/0032-the-re-review-verifies-the-fix-it-was-handed.md)).
 */
async function reviewBranch(
  crew: Crew,
  workItem: number,
  axes: BranchAxes,
  progress: PassProgress,
): Promise<StageResult> {
  const report = await reviewAndFix(crew, {
    kind: "branch",
    workItem,
    axes,
    verifying: undefined,
  });
  const declined = report.skipped;
  const fixed = report.fixed;
  progress.unaddressed.push(...declined);
  const blocked = blockFor(declined);
  if (blocked) return { fixed, blocked };
  // Nothing changed, so there is nothing new to read: a review that found
  // nothing, or a fixer that declined all of it, has already been accounted for.
  if (fixed.length === 0) return { fixed };

  // The same axes as the first run: what it verifies is that review's own
  // findings, so an axis dropped here would be a claim nobody checked.
  const findings = await crew.review({ kind: "branch", workItem, axes, verifying: fixed });
  const raised = findings.map((finding) => ({ finding, reason: REREVIEW_REASON }));
  progress.unaddressed.push(...raised);
  // Only the re-review's own findings can block from here: whatever the fixer
  // declined was already judged above, and it did not.
  return { fixed, blocked: blockFor(raised) };
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

  const detail = binding
    .map(({ finding, reason }) => `[${findingLabel(finding)}] ${finding.summary} — ${reason}`)
    .join("; ");
  return {
    kind: "mid-block",
    reason: `the branch does not do what the item asked, and nobody addressed it: ${detail}`,
  };
}

/**
 * The quality review and its fix, neither of which may stop the pass by any
 * means.
 *
 * Its own sequence rather than `reviewAndFix`'s, because the degrade between the
 * two legs is what this stage is: the shared helper cannot express it, and the
 * ticket and branch scopes must not gain it
 * ([ADR-0036](../../docs/adr/0036-a-leg-that-fails-to-answer-blocks-the-pass-and-never-on-quality.md)).
 *
 * - A **reviewer** that fails to answer means the stage produced nothing. There
 *   are no findings, so nothing is unaddressed and there is nothing to fix.
 * - A **fixer** that fails to answer means the findings it was handed were never
 *   decided, so every one of them is unaddressed under `QUALITY_FIXER_NO_ANSWER_REASON`.
 *   Whatever it had already committed is judged by the green gate next, which is
 *   this stage's only verifier by design.
 *
 * Either way the pass carries on to the gate. Both are named on the console,
 * because the handover cannot tell a skipped review from one that found nothing.
 */
async function reviewQuality(
  crew: Crew,
  workItem: number,
  settled: readonly Finding[],
  progress: PassProgress,
): Promise<void> {
  let findings: Finding[];
  try {
    findings = await crew.review({ kind: "quality", workItem, settled });
  } catch (error) {
    if (!(error instanceof RoleError)) throw error;
    console.error(`relay: the quality review failed to answer, and cannot block: ${error.message}`);
    return;
  }
  if (findings.length === 0) return;

  try {
    const report = await crew.fix(findings, { kind: "quality" });
    progress.unaddressed.push(...report.skipped);
  } catch (error) {
    if (!(error instanceof RoleError)) throw error;
    console.error(`relay: the quality fixer failed to answer, and cannot block: ${error.message}`);
    progress.unaddressed.push(
      ...findings.map((finding) => ({ finding, reason: QUALITY_FIXER_NO_ANSWER_REASON })),
    );
  }
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
}

/**
 * Run the gate, handing each red verdict to the fixer until green or capped.
 *
 * A gate finding needs no binding rule of its own: a gate the fixer declined
 * stays red, and the cap below is what blocks. Its declines are still reported,
 * because a fixer that talked its way past a red gate that then went green on
 * its own is worth a human knowing about.
 *
 * Each run's verdict goes into `progress` as that run answers, so what the
 * handover reports is the last verdict the loop actually reached — including when
 * a fixer between two runs fails to answer. The lander's own re-gate travels in
 * its `LandResult` instead, since what it verified is a branch the loop never saw.
 */
async function driveGate(
  crew: Crew,
  gate: ResolvedGate,
  progress: PassProgress,
): Promise<GateLoop> {
  let result = await crew.greenGate(1, gate);
  let runs = 1;
  progress.gate = gatedVerdict(gate, result);
  for (let attempt = 1; !result.green && attempt <= MAX_GATE_FIX_ATTEMPTS; attempt++) {
    const report = await crew.fix([gateFinding(result.detail)], { kind: "gate", attempt });
    progress.unaddressed.push(...report.skipped);
    result = await crew.greenGate(attempt + 1, gate);
    runs++;
    progress.gate = gatedVerdict(gate, result);
  }
  return {
    outcome: result.green
      ? { kind: "success", detail: result.detail }
      : { kind: "mid-block", reason: result.detail },
    runs,
  };
}

/** What one gate run said, as the verdict the handover reports. */
function gatedVerdict(gate: ResolvedGate, result: GateResult): GateVerdict {
  return { kind: "gated", gate, green: result.green, detail: result.detail };
}

function gateFinding(detail: string): Finding {
  return { source: "green-gate", summary: detail };
}
