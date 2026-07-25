import type { Sandbox } from "@ai-hero/sandcastle";
import type { RelayConfig } from "./config.js";
import { createFixer } from "./fixer.js";
import { createImplementer } from "./implementer.js";
import type { JiraIssue } from "./jira.js";
import { createPlanner } from "./planner.js";
import { createReviewer } from "./reviewer.js";
import { createStubCrew } from "./stub-crew.js";

/** One ticket of the pass's plan: the unit an implementer leg runs over. */
export interface TicketRef {
  key: string;
  summary: string;
}

/** What the planner resolved: tickets in dependency order, or a bail to a human. */
export type PlanResult =
  | { kind: "plan"; tickets: TicketRef[] }
  | { kind: "under-specified"; reason: string };

/**
 * How an implementer leg ended. A role that wants human input never pauses the
 * pass: it reports it, and the harness collapses it into a mid-block handover.
 */
export type ImplementResult =
  /** `base` is the commit the branch was at before the ticket was implemented. */
  | { kind: "done"; base: string }
  | { kind: "needs-input"; reason: string };

/** The four review lenses, named as the per-role model map names them. */
export type ReviewLens =
  | "fastCodeReview"
  | "fastSpecReview"
  | "inDepthCodeReview"
  | "inDepthSpecReview";

/** Whatever produced a finding the fixer has to act on. */
export type FindingSource = ReviewLens | "qualityGate";

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
  | { kind: "ticket"; ticket: TicketRef; base: string }
  | { kind: "branch"; workItem: string };

/**
 * What one fixer leg is fixing: a ticket's own lenses, the whole-branch lenses,
 * or a red gate. A gate fix carries which attempt of the loop it is, because
 * the gate is the pass's one leg that runs more than once.
 */
export type FixTarget =
  | { kind: "ticket"; ticket: TicketRef }
  | { kind: "branch" }
  | { kind: "gate"; attempt: number };

/**
 * How the pass ended, and therefore which handover it gets.
 *
 * `early-bail` is the planner refusing an under-specified item before any work
 * happened; `mid-block` is work that started but could not be finished.
 */
export type Outcome =
  | { kind: "success" }
  | { kind: "mid-block"; reason: string }
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
  qualityGate(): Promise<GateResult>;
  handover(outcome: Outcome): Promise<void>;
}

/**
 * The crew a real pass runs: each role that has been built runs in the pass's
 * sandbox, and the rest are still stubs. A later ticket replaces one more.
 *
 * Every stub is named here rather than spread in from `createStubCrew`, so a
 * role that is still fake cannot hide. **A pass therefore still reports green
 * from a gate that never ran** — the two below are what is left to build, and
 * a seventh role added to `Crew` will not compile until it is wired.
 */
export function createCrew({
  sandbox,
  config,
  outputDir,
}: {
  sandbox: Sandbox;
  config: RelayConfig;
  outputDir: string;
}): Crew {
  const stub = createStubCrew();
  return {
    plan: createPlanner({ sandbox, config }),
    implement: createImplementer({ sandbox, config }),
    review: createReviewer({ sandbox, config, outputDir }),
    fix: createFixer({ sandbox, config }),
    qualityGate: stub.qualityGate,
    handover: stub.handover,
  };
}
