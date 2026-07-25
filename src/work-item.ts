import { SelectionError } from "./errors.js";
import type { JiraClient, JiraIssue } from "./jira.js";
import type { TrackerScope } from "./tracker-doc.js";

/** The issue types relay is allowed to run a pass over. */
const RUNNABLE_TYPES = ["Story", "Bug", "Vulnerability"] as const;

/** The label that marks an item as agent-grabbable. Never bypassed. */
const READY_LABEL = "ready-for-agent";

/** The label a run holds an item with, so two runs never share one item. */
const RUNNING_LABEL = "agent-running";

/** Either the one item this pass runs, or an empty frontier. */
export type Selection = { kind: "work-item"; issue: JiraIssue } | { kind: "nothing-to-do" };

/**
 * The frontier query: this repo's eligible items, most important and
 * longest-waiting first. Ordering is Jira's, so the first candidate whose
 * blockers are all done wins.
 */
export function frontierJql(scope: TrackerScope): string {
  return (
    `project = ${scope.projectKey}` +
    ` AND labels = "${scope.repoLabel}"` +
    ` AND labels = "${READY_LABEL}"` +
    " AND statusCategory != Done" +
    ` AND labels not in ("${RUNNING_LABEL}")` +
    ` AND issuetype in (${RUNNABLE_TYPES.join(", ")})` +
    " ORDER BY priority DESC, created ASC"
  );
}

/**
 * Resolve the one work item this pass runs.
 *
 * With no key, the first frontier item wins, and an empty frontier is a clean
 * nothing-to-do. With a key, that item is held to the same gates with no
 * override — any failure breaks the pass loudly rather than skipping on.
 */
export async function selectWorkItem(
  client: JiraClient,
  scope: TrackerScope,
  workItem?: string,
): Promise<Selection> {
  return workItem === undefined
    ? await autoPick(client, scope)
    : { kind: "work-item", issue: await pickByKey(client, scope, workItem) };
}

async function autoPick(client: JiraClient, scope: TrackerScope): Promise<Selection> {
  const candidates = await client.search(frontierJql(scope));
  const issue = candidates.find((candidate) => openBlockers(candidate).length === 0);
  return issue ? { kind: "work-item", issue } : { kind: "nothing-to-do" };
}

async function pickByKey(
  client: JiraClient,
  scope: TrackerScope,
  key: string,
): Promise<JiraIssue> {
  const issue = await client.getIssue(key);
  if (!issue) throw new SelectionError(`${key} does not exist or is not visible.`);
  const failure = gateFailure(issue, scope);
  if (failure) throw new SelectionError(`${issue.key} ${failure}`);
  return issue;
}

/**
 * The first gate the item fails, phrased as a reason, or `undefined` when it
 * passes them all. Types come first: running the wrong type of work is the one
 * failure relay must never get close to.
 */
function gateFailure(issue: JiraIssue, scope: TrackerScope): string | undefined {
  if (!isRunnableType(issue)) {
    return `is a ${issue.issueType} — relay only runs ${RUNNABLE_TYPES.join(", ")}.`;
  }
  if (!issue.key.startsWith(`${scope.projectKey}-`)) {
    return `is not in project ${scope.projectKey}.`;
  }
  if (!issue.labels.includes(scope.repoLabel)) {
    return `is not labelled ${scope.repoLabel}, so it is not this repo's work.`;
  }
  if (!issue.labels.includes(READY_LABEL)) {
    return `is not labelled ${READY_LABEL}.`;
  }
  if (issue.labels.includes(RUNNING_LABEL)) {
    return `is labelled ${RUNNING_LABEL} — another run holds it.`;
  }
  if (issue.isDone) {
    return "is already done.";
  }
  const blockers = openBlockers(issue);
  if (blockers.length > 0) {
    return `is blocked by ${blockers.map((blocker) => blocker.key).join(", ")}.`;
  }
  return undefined;
}

function isRunnableType(issue: JiraIssue): boolean {
  return RUNNABLE_TYPES.some((type) => type === issue.issueType);
}

function openBlockers(issue: JiraIssue) {
  return issue.blockedBy.filter((blocker) => !blocker.isDone);
}
