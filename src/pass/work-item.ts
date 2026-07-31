import { SelectionError } from "../errors.js";
import { type GitHubBlocker, type GitHubClient, type GitHubIssue } from "../tracker/github.js";
import { HELD_LABEL, READY_LABEL } from "../tracker/labels.js";

/** Either the one item this pass runs, or an empty frontier. */
export type Selection = { kind: "work-item"; workItem: GitHubIssue } | { kind: "nothing-to-do" };

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
    : { kind: "work-item", workItem: await pickByName(client, workItem) };
}

async function autoPick(client: GitHubClient): Promise<Selection> {
  const candidates = await client.frontier();
  const workItem = candidates.find((candidate) => eligibilityFailure(candidate) === undefined);
  return workItem ? { kind: "work-item", workItem } : { kind: "nothing-to-do" };
}

async function pickByName(client: GitHubClient, named: NamedWorkItem): Promise<GitHubIssue> {
  await requireThisRepository(client, named);
  const workItem = await client.getIssue(named.number);
  if (!workItem) throw new SelectionError(`#${named.number} does not exist or is not visible.`);
  const failure = eligibilityFailure(workItem);
  if (failure) throw new SelectionError(`#${workItem.number} ${failure}`);
  return workItem;
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
 * What an operator is told about a work item that is somebody's sub-issue, or
 * `undefined` when it is nobody's.
 *
 * Never a gate: a childless issue is its own single ticket whoever's child it is,
 * so relay gates on the ready label rather than on the shape of the graph
 * ([ADR-0008](../../docs/adr/0008-the-native-github-graph-is-the-tracker-model.md)).
 * What the notice says is what the pass is therefore *not* doing — the siblings
 * are not in it — because an operator who named the wrong number, or whose
 * auto-pick reached past a held parent, would otherwise only learn that from the
 * diff.
 *
 * A sentence rather than a print, so the one rule reads the same for both
 * selection paths and can be asserted without a console.
 */
export function subIssueNotice(workItem: GitHubIssue): string | undefined {
  if (workItem.parent === undefined) return undefined;

  return (
    `#${workItem.number} is a sub-issue of #${workItem.parent}, and this pass runs over ` +
    `#${workItem.number} alone — as its own single ticket, without #${workItem.parent}'s ` +
    `other sub-issues. Run relay on #${workItem.parent} to cover the whole plan.`
  );
}

/**
 * The first gate the item fails, phrased as a reason, or `undefined` when it
 * passes them all. The one eligibility check both paths run, so an auto-pick
 * and a named item can never disagree about what relay is allowed to run.
 */
function eligibilityFailure(workItem: GitHubIssue): string | undefined {
  if (!workItem.labels.includes(READY_LABEL)) {
    return `is not labelled ${READY_LABEL}.`;
  }
  if (workItem.labels.includes(HELD_LABEL)) {
    // Nothing removes this label on a crash, so relay says how to lift the hold
    // rather than leaving the operator at a dead end. Lifting it is a human's
    // call: only they can tell a running pass from a dead one.
    return (
      `is held by a pass, labelled ${HELD_LABEL}. If no pass is running it crashed — ` +
      `review its branch, then \`gh issue edit ${workItem.number} --remove-label ${HELD_LABEL}\` ` +
      "and run again."
    );
  }
  if (!workItem.isOpen) {
    return "is closed.";
  }
  const blockers = openBlockers(workItem);
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
function openBlockers(workItem: GitHubIssue): GitHubBlocker[] {
  return workItem.blockedBy.filter((blocker) => blocker.isOpen);
}

/** Repo-qualified, so a blocker in another repository reads as one. */
function nameOf(blocker: GitHubBlocker): string {
  return `${blocker.repository}#${blocker.number}`;
}
