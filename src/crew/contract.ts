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

/** The four review lenses, named as the per-role model map names them. */
export type ReviewLens =
  "fastCodeReview" | "fastSpecReview" | "inDepthCodeReview" | "inDepthSpecReview";

/** Whatever produced a finding the fixer has to act on. */
export type FindingSource = ReviewLens | "greenGate";

/** One thing a reviewer or the gate wants changed. */
export interface Finding {
  source: FindingSource;
  /** The ticket the finding is about; absent for whole-branch findings. */
  ticket?: number;
  summary: string;
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
 * What the reviewers look at: one ticket's change, or the whole branch.
 *
 * Each arm carries the issue whose intent the change is measured against — the
 * ticket's own brief, or the work item the whole branch belongs to. A ticket
 * also carries the commit its own change starts at, since the branch already
 * holds every earlier ticket of the pass.
 */
export type ReviewScope =
  { kind: "ticket"; ticket: TicketRef; base: string } | { kind: "branch"; workItem: number };

/**
 * What one fixer leg is fixing: a ticket's own lenses, the whole-branch lenses,
 * or a red gate. A gate fix carries which attempt of the loop it is, because
 * the gate is the pass's one leg that runs more than once.
 */
export type FixTarget =
  { kind: "ticket"; ticket: TicketRef } | { kind: "branch" } | { kind: "gate"; attempt: number };

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
  plan(issue: GitHubIssue): Promise<PlanResult>;
  implement(ticket: TicketRef): Promise<ImplementResult>;
  review(lens: ReviewLens, scope: ReviewScope): Promise<Finding[]>;
  fix(findings: readonly Finding[], target: FixTarget): Promise<void>;
  /**
   * Run the gate once, on the resolved gate the harness hands it. `attempt` is
   * which run of the harness's gate loop this is, so the pass's repeated gate
   * legs stay apart in its logs.
   */
  greenGate(attempt: number, gate: ResolvedGate): Promise<GateResult>;
  /**
   * Hand the baton over. `committed` is the tickets whose change the branch
   * carries, in the order they were implemented — what the pull request closes,
   * and what decides whether there is a pull request at all.
   */
  handover(outcome: Outcome, committed: readonly TicketRef[]): Promise<void>;
}
