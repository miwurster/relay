import type { Sandbox } from "@ai-hero/sandcastle";
import type { RelayConfig } from "./config.js";
import { createFixer } from "./fixer.js";
import { createGreenGate } from "./green-gate.js";
import { createHandover } from "./handover.js";
import { createImplementer } from "./implementer.js";
import type { JiraIssue } from "./jira.js";
import { createPlanner } from "./planner.js";
import { createReviewer } from "./reviewer.js";

/** One ticket of the pass's plan: the unit an implementer leg runs over. */
export interface TicketRef {
  key: string;
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
  ticket?: string;
  summary: string;
}

/** The verdict of one green-gate run. */
export interface GateResult {
  green: boolean;
  detail: string;
}

/**
 * What the reviewers look at: one ticket's change, or the whole branch.
 *
 * Each arm carries the key whose intent the change is measured against — the
 * ticket's own brief, or the work item the whole branch belongs to. A ticket
 * also carries the commit its own change starts at, since the branch already
 * holds every earlier ticket of the pass.
 */
export type ReviewScope =
  { kind: "ticket"; ticket: TicketRef; base: string } | { kind: "branch"; workItem: string };

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
 * happened; `mid-block` is work that started but could not be finished. A
 * mid-block carries whether any ticket was implemented before it blocked,
 * because that is what decides whether there is anything to publish.
 */
export type Outcome =
  | { kind: "success" }
  | { kind: "mid-block"; reason: string; hasWork: boolean }
  | { kind: "early-bail"; reason: string };

/**
 * The crew of roles one pass runs. Every role is its own cold agent session
 * sharing only the worktree's files and git history, so the harness passes
 * nothing between them but the small values in this file.
 */
export interface Crew {
  plan(issue: JiraIssue): Promise<PlanResult>;
  implement(ticket: TicketRef): Promise<ImplementResult>;
  review(lens: ReviewLens, scope: ReviewScope): Promise<Finding[]>;
  fix(findings: readonly Finding[], target: FixTarget): Promise<void>;
  /**
   * Run the gate once. `attempt` is which run of the harness's gate loop this
   * is, so the pass's repeated gate legs stay apart in its logs.
   */
  greenGate(attempt: number): Promise<GateResult>;
  handover(outcome: Outcome): Promise<void>;
}

/**
 * The crew a real pass runs: every role in the pass's own sandbox, from the
 * plan to the handover that gives the human the baton.
 */
export function createCrew({
  sandbox,
  config,
  outputDir,
  workItem,
  branch,
}: {
  sandbox: Sandbox;
  config: RelayConfig;
  outputDir: string;
  /** The key of the work item this pass runs over. */
  workItem: string;
  /** The branch the pass commits to, and the handover publishes. */
  branch: string;
}): Crew {
  return {
    plan: createPlanner({ sandbox, config, outputDir }),
    implement: createImplementer({ sandbox, config, outputDir }),
    review: createReviewer({ sandbox, config, outputDir }),
    fix: createFixer({ sandbox, config, outputDir }),
    greenGate: createGreenGate({ sandbox, config, outputDir }),
    handover: createHandover({ sandbox, config, outputDir, workItem, branch }),
  };
}
