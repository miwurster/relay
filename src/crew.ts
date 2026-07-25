import type { JiraIssue } from "./jira.js";

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
export type ImplementResult = { kind: "done" } | { kind: "needs-input"; reason: string };

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

/** What the reviewers look at: one ticket's change, or the whole branch. */
export type ReviewScope = { kind: "ticket"; ticket: TicketRef } | { kind: "branch" };

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
  fix(findings: readonly Finding[]): Promise<void>;
  qualityGate(): Promise<GateResult>;
  handover(outcome: Outcome): Promise<void>;
}

/**
 * A crew of stubs: the whole topology runs and every exit path is reachable
 * without an agent, a model or a network. Each real role replaces one method
 * of this in a later ticket.
 */
export function createStubCrew(): Crew {
  return {
    async plan(issue) {
      log("planner", `would plan ${issue.key}`);
      return { kind: "plan", tickets: [{ key: issue.key, summary: "the work item itself" }] };
    },

    async implement(ticket) {
      log("implementer", `would implement ${ticket.key}`);
      return { kind: "done" };
    },

    async review(lens, scope) {
      const target = scope.kind === "ticket" ? scope.ticket.key : "the branch";
      log(lens, `would review ${target}`);
      return [];
    },

    async fix(findings) {
      const deduped = dedupeFindings(findings);
      log("fixer", `would fix ${deduped.length} of ${findings.length} findings`);
    },

    async qualityGate() {
      log("qualityGate", "would run the green gate");
      return { green: true, detail: "stub gate is always green" };
    },

    async handover(outcome) {
      log("handover", `would hand over: ${outcome.kind}`);
    },
  };
}

/**
 * Concurrent lenses see the same code, so the same problem arrives more than
 * once. The fixer is where that collapses — the harness merges blindly.
 */
function dedupeFindings(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings) {
    const key = `${finding.ticket ?? ""}\0${finding.summary}`;
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()];
}

function log(role: string, message: string): void {
  console.log(`relay: [${role} stub] ${message}`);
}
