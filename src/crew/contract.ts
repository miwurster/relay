import type { GitHubIssue } from "../tracker/github.js";

/** One ticket of the pass's plan: the unit an implementer leg runs over. */
export interface TicketRef {
  number: number;
  summary: string;
}

/** What the planner resolved: tickets in dependency order, or a bail to a human. */
export type PlanResult =
  { kind: "plan"; tickets: TicketRef[] } | { kind: "under-specified"; reason: string };

/**
 * How an implementer leg ended. A role that wants human input never pauses the
 * pass: it reports it, and the harness collapses it into a mid-block handover.
 */
export type ImplementResult =
  /** `base` is the commit the branch was at before the ticket was implemented. */
  { kind: "done"; base: string } | { kind: "needs-input"; reason: string };

/**
 * The three reviews, named as the per-role model map names them.
 *
 * One per `ReviewScope`, since a review is only ever the scope it read
 * ([ADR-0027](../../docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
 */
export type ReviewKind = "ticket-review" | "branch-review" | "quality-review";

/**
 * Which question a finding answers.
 *
 * - `standards` — does the change follow this repo's own documented conventions?
 * - `spec` — did it build what the item asked for?
 * - `quality` — is the implementation structurally worth keeping, judged against
 *   an external maintainability rubric that reaches beyond the diff.
 *
 * They do not weigh the same. A branch that does not do what was asked is worse
 * to land than one that landed with a standards or a quality call overridden, so
 * a spec finding is **binding** and the other two are not
 * ([ADR-0021](../../docs/adr/0021-spec-findings-are-binding.md)).
 */
export type Axis = "standards" | "spec" | "quality";

/** The axis sets a branch review may be asked for, named as the reviewer's table names them. */
export type BranchAxes = "both" | "spec";

/**
 * One thing a review or the gate wants changed.
 *
 * A review finding carries the **axis** it came from. The gate's carries none:
 * a gate verdict is neither of the review's questions, and it needs no binding
 * rule of its own — a gate the fixer left alone stays red, and the gate loop
 * blocks the pass by itself.
 */
export type Finding =
  | {
      source: ReviewKind;
      axis: Axis;
      /** The ticket the finding is about; absent for whole-branch findings. */
      ticket?: number;
      summary: string;
    }
  | { source: "green-gate"; summary: string };

/**
 * Whether the pass may not land without this finding addressed.
 *
 * The one place `binding` is defined, so the fixer's prompt, the harness's
 * block and the handover's report cannot drift apart on what it means.
 */
export function isBinding(finding: Finding): boolean {
  return finding.source !== "green-gate" && finding.axis === "spec";
}

/** How a finding is labelled wherever one is listed, for the fixer or a human. */
export function findingLabel(finding: Finding): string {
  return finding.source === "green-gate" ? "gate" : finding.axis;
}

/**
 * What the fixer did with one finding: changed code for it, or declined it and
 * said why.
 *
 * Per finding, never per leg. The fixer decides whether code changes; what an
 * unaddressed finding costs the pass is the harness's, so a decline is a report
 * rather than a veto.
 */
export type Verdict = { kind: "fixed" } | { kind: "skipped"; reason: string };

/**
 * A finding the pass left unaddressed, and why nobody acted on it.
 *
 * Two things reach this: a finding the fixer declined, and a finding the
 * **re-review** raised, which by design reaches no fixer at all.
 */
export interface UnaddressedFinding {
  finding: Finding;
  reason: string;
}

/** What one fixer leg did with the findings it was handed. */
export interface FixReport {
  /** The findings it changed code for. */
  fixed: readonly Finding[];
  /** The findings it declined, each with the reason it gave. */
  skipped: readonly UnaddressedFinding[];
}

/** The verdict of one green-gate run. */
export interface GateResult {
  green: boolean;
  detail: string;
}

/**
 * The command a gate run verifies with, and where relay got it — resolved
 * once per pass and handed to every attempt of the gate loop, so a red gate
 * cannot change command between attempts.
 */
export interface ResolvedGate {
  /** The command whose exit code decides green. */
  command: string;
  provenance: "declared" | "inferred";
  /** One line naming where it came from, for a human to read. */
  source: string;
}

/**
 * What a pass verified with and what the gate said about it, or that the pass
 * never got as far as asking.
 *
 * `not-gated` rather than an absent verdict, for the same reason `no-landing`
 * exists: a leg that never ran is a fact the handover has to be able to state,
 * not one it has to infer from an absence. Both arms carry the resolved gate,
 * because the gate resolver is the pass's first leg — so even a pass that
 * blocked before the gate knows the command it would have run.
 */
export type GateVerdict =
  | { kind: "gated"; gate: ResolvedGate; green: boolean; detail: string }
  | { kind: "not-gated"; gate: ResolvedGate };

/** The verdict of a pass that has not reached its gate, which every pass starts as. */
export function notGated(gate: ResolvedGate): GateVerdict {
  return { kind: "not-gated", gate };
}

/**
 * What one review reads: one ticket's change, the whole branch against what was
 * asked, or the whole branch against a maintainability rubric.
 *
 * Each arm carries the issue the change is measured against — the ticket's own
 * brief, or the work item the whole branch belongs to. A ticket also carries the
 * commit its own change starts at, since the branch already holds every earlier
 * ticket of the pass.
 *
 * The scope is what decides the review's prompt, its model, the axes it is asked
 * for and the shape it answers in, which is why the quality review is a scope
 * rather than a role of its own
 * ([ADR-0027](../../docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
 */
export type ReviewScope =
  | { kind: "ticket"; ticket: TicketRef; base: string }
  | {
      kind: "branch";
      workItem: number;
      /**
       * Which axes this run is asked for: `both` when no ticket review ran, so
       * the branch review is the pass's only read of the repo's own conventions,
       * and `spec` when every ticket was already read on `standards` by its own
       * review ([ADR-0031](../../docs/adr/0031-the-branch-review-takes-the-standards-axis-when-no-ticket-review-ran.md)).
       */
      axes: BranchAxes;
      /**
       * The findings the branch review's fixer said it fixed, on the second run
       * that verifies them; absent on the first run, which has no fix to read.
       *
       * Carrying them is what makes that run a verification rather than the
       * branch review again: it asks only whether these were addressed, so a
       * problem in the fixer's own new code is not a finding it can raise
       * ([ADR-0032](../../docs/adr/0032-the-re-review-verifies-the-fix-it-was-handed.md)).
       * Exactly one such run, never a loop, and report-only: its findings reach
       * no fixer ([ADR-0022](../../docs/adr/0022-a-fix-is-verified-once.md)).
       */
      verifying: readonly Finding[] | undefined;
    }
  | { kind: "quality"; workItem: number };

/** Which of the three reviews a scope is, in the model map and on its findings. */
export function reviewKindOf(scope: ReviewScope): ReviewKind {
  switch (scope.kind) {
    case "ticket":
      return "ticket-review";
    case "branch":
      return "branch-review";
    case "quality":
      return "quality-review";
  }
}

/**
 * What one fixer leg is fixing: a ticket's own review, the whole-branch review,
 * the quality review, or a red gate. A gate fix carries which attempt of the
 * loop it is, because the gate is the pass's one leg that runs more than once.
 */
export type FixTarget =
  | { kind: "ticket"; ticket: TicketRef }
  | { kind: "branch" }
  | { kind: "quality" }
  | { kind: "gate"; attempt: number };

/**
 * What became of the base branch.
 *
 * `landed` means it has moved and is pushed, so the work is reachable by
 * somebody other than the operator who ran the pass; `not-landed` means it was
 * left where it was, and why, which blocks the pass. `no-landing` is neither
 * of those: there was nothing to land, because the repo lands through a pull
 * request or because the pass blocked before it reached its lander.
 */
export type LandResult =
  | { kind: "landed"; detail: string }
  | { kind: "not-landed"; reason: string }
  | { kind: "no-landing" };

/** The one `no-landing`, since it has nothing to say beyond its kind. */
export const NO_LANDING: LandResult = { kind: "no-landing" };

/**
 * How the pass ended, and therefore which handover it gets.
 *
 * `early-bail` is the planner refusing an under-specified item before any work
 * happened; `mid-block` is work that started but could not be finished. What
 * there is to publish is not part of the outcome: the handover is handed the
 * committed tickets themselves.
 */
export type Outcome =
  | { kind: "success"; detail: string }
  | { kind: "mid-block"; reason: string }
  | { kind: "early-bail"; reason: string };

/**
 * The crew of roles one pass runs. Every role is its own cold agent session
 * sharing only the worktree's files and git history, so the harness passes
 * nothing between them but the small values in this file.
 */
export interface Crew {
  /**
   * Resolve the gate the pass verifies with, from the repo's own docs. Run once,
   * as the pass's first leg, so every later leg means the same command by green.
   */
  resolveGate(): Promise<ResolvedGate>;
  plan(workItem: GitHubIssue): Promise<PlanResult>;
  implement(ticket: TicketRef): Promise<ImplementResult>;
  /**
   * Read one scope and report what it wants changed. The `quality` scope is the
   * one that is not bounded by its diff: its rubric's remedies reach into the
   * code the change sits in
   * ([ADR-0027](../../docs/adr/0027-the-branch-review-splits-into-a-spec-review-and-a-quality-review.md)).
   */
  review(scope: ReviewScope): Promise<Finding[]>;
  /**
   * Act on the findings handed to it, one verdict per finding. It reports what
   * it declined rather than judging what that costs — the harness blocks the
   * pass over a binding finding nobody addressed.
   */
  fix(findings: readonly Finding[], target: FixTarget): Promise<FixReport>;
  /**
   * Run the gate once, on the resolved gate the harness hands it. `attempt` is
   * which run of the harness's gate loop this is, so the pass's repeated gate
   * legs stay apart in its logs.
   */
  greenGate(attempt: number, gate: ResolvedGate): Promise<GateResult>;
  /**
   * Put the pass branch's work on the base branch, and say what became of it.
   * A repo that lands through a pull request has nothing to put anywhere and
   * reports `no-landing` without running a leg at all.
   *
   * Under `merge` landing this is the one member that is a leg plus a host git
   * action: the leg gets the base branch's commits into the pass branch, and
   * the host's own `git` then fast-forwards the base branch onto the result and
   * pushes it.
   *
   * `regate` is the harness's green gate, run on what the leg produced —
   * nothing reaches the host until a gate has passed on what will actually
   * land, because the earlier verdict said nothing about code that has since
   * moved.
   */
  land(regate: () => Promise<GateResult>): Promise<LandResult>;
  /**
   * Hand the baton over. `committed` is the tickets whose change the branch
   * carries, in the order they were implemented — what the pull request closes,
   * and what decides whether there is a pull request at all.
   *
   * `finished` is the committed tickets the pass actually earned a done for: the
   * harness's own derivation, so no leg has to work out which of the committed
   * ones a blocked pass may still claim. It is the list the handover records as
   * done, while `committed` stays what a `Closes` line is owed per ticket for.
   *
   * `blocked` is the tickets a human has to decide about — the harness's
   * derivation too, and not `committed` minus `finished`: a ticket an implementer
   * asked for a human over never reached `committed`, and a branch-scope finding
   * leaves the whole branch at fault without naming a ticket.
   *
   * `land` is what the lander did, or `no-landing` when there was none to do.
   * The handover is told it rather than working it out from the landing and the
   * outcome, because closing an issue is the pass's one irreversible tracker
   * act and the leg that does it has to be reading the lander's own verdict.
   *
   * `gate` is what the pass verified with and what came of it, `not-gated` when
   * the pass blocked before the gate ran. Told for the same reason `land` is: the
   * report and the tracker comment both name the gate, and a leg left to work
   * that out has only the repo's docs to read — which is the gate resolver's job,
   * already done, and answers what a gate *would* verify with rather than what
   * this pass's gate said.
   *
   * `unaddressed` is every finding nobody acted on, in the order the legs ran.
   * A green pass can only carry non-binding ones, and the human is owed the
   * fact that a role overrode a call about their repo — a skip a pass swallowed
   * is the failure this reports its way out of.
   */
  handover(
    outcome: Outcome,
    committed: readonly TicketRef[],
    finished: readonly TicketRef[],
    blocked: readonly TicketRef[],
    land: LandResult,
    gate: GateVerdict,
    unaddressed: readonly UnaddressedFinding[],
  ): Promise<void>;
}
