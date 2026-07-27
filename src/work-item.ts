import { SelectionError } from "./errors.js";
import { READY_LABEL, type GitHubBlocker, type GitHubClient, type GitHubIssue } from "./github.js";

/** The label a running pass holds an item with. A held item is someone's run. */
const HELD_LABEL = "agent-in-progress";

/** Either the one item this pass runs, or an empty frontier. */
export type Selection = { kind: "work-item"; issue: GitHubIssue } | { kind: "nothing-to-do" };

/** The issue an operator named, and the repository they named it in. */
export interface NamedWorkItem {
  number: number;
  /** Only a URL names one; a bare `42` means the clone relay was started in. */
  repository?: string;
}

/**
 * The three forms an operator has an issue to hand in: the number as they would
 * type it, `#42` as pasted from a comment, and the URL their browser gives them.
 * Anchored, so nothing but one of those three forms gets through.
 */
const NAMED_ISSUE = /^(?:#|https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/)?(\d+)$/;

/**
 * The item an operator named, whichever form they used. Rejected here rather
 * than at the tracker: a call that cannot name an issue is not worth making.
 */
export function parseWorkItem(argument: string): NamedWorkItem {
  const named = NAMED_ISSUE.exec(argument);
  const number = Number(named?.[2]);
  if (!Number.isInteger(number) || number <= 0) {
    throw new SelectionError(`${argument} does not name a GitHub issue: use 42, #42 or its URL.`);
  }
  const repository = named?.[1];
  return repository === undefined ? { number } : { number, repository };
}

/**
 * Resolve the one work item this pass runs.
 *
 * With no number, the first eligible frontier item wins — the frontier is
 * ordered longest-waiting first — and an empty frontier is a clean
 * nothing-to-do. With a number, that item is held to the same gates with no
 * override: any failure breaks the pass loudly rather than skipping on.
 */
export async function selectWorkItem(
  client: GitHubClient,
  workItem?: NamedWorkItem,
): Promise<Selection> {
  return workItem === undefined
    ? await autoPick(client)
    : { kind: "work-item", issue: await pickByName(client, workItem) };
}

async function autoPick(client: GitHubClient): Promise<Selection> {
  const candidates = await client.frontier();
  const issue = candidates.find((candidate) => eligibilityFailure(candidate) === undefined);
  return issue ? { kind: "work-item", issue } : { kind: "nothing-to-do" };
}

async function pickByName(client: GitHubClient, named: NamedWorkItem): Promise<GitHubIssue> {
  await requireThisRepository(client, named);
  const issue = await client.getIssue(named.number);
  if (!issue) throw new SelectionError(`#${named.number} does not exist or is not visible.`);
  const failure = eligibilityFailure(issue);
  if (failure) throw new SelectionError(`#${issue.number} ${failure}`);
  return issue;
}

/**
 * A pass only ever runs over the clone it was started in, so a URL naming
 * another repository is a wrong browser tab rather than a work item — and
 * without this it would silently resolve to this repo's issue of that number.
 */
async function requireThisRepository(client: GitHubClient, named: NamedWorkItem): Promise<void> {
  if (named.repository === undefined) return;
  const repository = await client.repository();
  // GitHub treats `owner/repo` case-insensitively, and so does a pasted URL.
  if (named.repository.toLowerCase() !== repository.toLowerCase()) {
    throw new SelectionError(
      `${named.repository}#${named.number} is not in ${repository}, the repository this clone runs against.`,
    );
  }
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
    // Nothing removes this label on a crash, so relay says how to lift the hold
    // rather than leaving the operator at a dead end. Lifting it is a human's
    // call: only they can tell a running pass from a dead one.
    return (
      `is held by a pass, labelled ${HELD_LABEL}. If no pass is running it crashed — ` +
      `review its branch, then \`gh issue edit ${issue.number} --remove-label ${HELD_LABEL}\` ` +
      "and run again."
    );
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
