import { SelectionError } from "./errors.js";
import { READY_LABEL, type GitHubBlocker, type GitHubClient, type GitHubIssue } from "./github.js";

/** The label a running pass holds an item with. A held item is someone's run. */
const HELD_LABEL = "agent-in-progress";

/** Either the one item this pass runs, or an empty frontier. */
export type Selection = { kind: "work-item"; issue: GitHubIssue } | { kind: "nothing-to-do" };

/**
 * The issue number an operator named, rejected here rather than at the tracker:
 * a call that cannot name an issue is not worth making.
 */
export function workItemNumber(argument: string): number {
  const number = Number(argument);
  if (!Number.isInteger(number) || number <= 0) {
    throw new SelectionError(`${argument} is not a GitHub issue number.`);
  }
  return number;
}

/**
 * Resolve the one work item this pass runs.
 *
 * With no number, the first eligible frontier item wins — the frontier is
 * ordered longest-waiting first — and an empty frontier is a clean
 * nothing-to-do. With a number, that item is held to the same gates with no
 * override: any failure breaks the pass loudly rather than skipping on.
 */
export async function selectWorkItem(client: GitHubClient, workItem?: number): Promise<Selection> {
  return workItem === undefined
    ? await autoPick(client)
    : { kind: "work-item", issue: await pickByNumber(client, workItem) };
}

async function autoPick(client: GitHubClient): Promise<Selection> {
  const candidates = await client.frontier();
  const issue = candidates.find((candidate) => eligibilityFailure(candidate) === undefined);
  return issue ? { kind: "work-item", issue } : { kind: "nothing-to-do" };
}

async function pickByNumber(client: GitHubClient, number: number): Promise<GitHubIssue> {
  const issue = await client.getIssue(number);
  if (!issue) throw new SelectionError(`#${number} does not exist or is not visible.`);
  const failure = eligibilityFailure(issue);
  if (failure) throw new SelectionError(`#${issue.number} ${failure}`);
  return issue;
}

/**
 * The first gate the item fails, phrased as a reason, or `undefined` when it
 * passes them all. The one eligibility check both paths run, so an auto-pick
 * and a named item can never disagree about what relay is allowed to run.
 */
function eligibilityFailure(issue: GitHubIssue): string | undefined {
  if (!issue.labels.includes(READY_LABEL)) {
    return `is not labelled ${READY_LABEL}.`;
  }
  if (issue.labels.includes(HELD_LABEL)) {
    return `is already held by a pass, labelled ${HELD_LABEL}.`;
  }
  if (!issue.isOpen) {
    return "is closed.";
  }
  const blockers = openBlockers(issue);
  if (blockers.length > 0) {
    return `is blocked by ${blockers.map(nameOf).join(", ")}.`;
  }
  return undefined;
}

/**
 * relay's own open-blocker filter. A blocked-by count is never trusted, since
 * GitHub's includes closed blockers and a finished dependency must not hold
 * work back forever.
 */
function openBlockers(issue: GitHubIssue): GitHubBlocker[] {
  return issue.blockedBy.filter((blocker) => blocker.isOpen);
}

/** Repo-qualified, so a blocker in another repository reads as one. */
function nameOf(blocker: GitHubBlocker): string {
  return `${blocker.repository}#${blocker.number}`;
}
