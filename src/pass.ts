import { loadConfig, type RelayConfig } from "./config.js";
import { type Crew, createStubCrew } from "./crew.js";
import { SandboxError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { exitCodeFor, runHarness } from "./harness.js";
import { createJiraClient, type JiraClient, type JiraIssue } from "./jira.js";
import { branchExists, openSandbox, passBranch, type RelaySandbox } from "./sandbox.js";
import { loadSecrets, type Secrets } from "./secrets.js";
import { loadTrackerScope } from "./tracker-doc.js";
import { selectWorkItem } from "./work-item.js";

/** The one work item's pass, and the two seams tests replace. */
export interface PassRun {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  issue: JiraIssue;
  jira: JiraClient;
  open?: typeof openSandbox;
  createCrew?: (sandbox: RelaySandbox) => Crew;
}

/**
 * Run one pass over a single work item, then hand off to a human.
 *
 * The pass fails fast on an invalid config or an unresolvable secret before
 * any sandbox work starts; deeper tool, auth and docker failures surface
 * lazily where they are first used.
 */
export async function runPass(workItem: string | undefined): Promise<ExitCode> {
  const repoRoot = process.cwd();
  const config = await loadConfig(repoRoot);
  const secrets = await loadSecrets();
  const scope = await loadTrackerScope(repoRoot);

  const jira = createJiraClient({
    baseUrl: config.jira.baseUrl,
    email: secrets.atlassian.email,
    token: secrets.atlassian.token,
  });

  const selection = await selectWorkItem(jira, scope, workItem);
  if (selection.kind === "nothing-to-do") {
    console.log(`relay: nothing to do — no ready work item for ${scope.repoLabel}`);
    return ExitCode.Success;
  }

  return await runPassOnItem({ repoRoot, config, secrets, issue: selection.issue, jira });
}

/**
 * Open the sandbox, run the crew in it, and dispose of it whatever happens.
 *
 * A crash is reported to Jira on the way out and then rethrown, so the caller
 * maps it to the error exit code. Relay never transitions the item back: it
 * stays In Progress, which is what a re-run after a crash expects to find.
 */
export async function runPassOnItem({
  repoRoot,
  config,
  secrets,
  issue,
  jira,
  open = openSandbox,
  createCrew = () => createStubCrew(),
}: PassRun): Promise<ExitCode> {
  const branch = passBranch(config, issue.key);
  await refuseOnBranchCollision(repoRoot, branch);

  let opened: RelaySandbox | undefined;
  try {
    // Inside the try: a sandbox that will not open is the likeliest crash of
    // all, and it deserves the same note on the item as one that dies later.
    opened = await open({ repoRoot, config, secrets, branch });
    const outcome = await runHarness(createCrew(opened), issue);
    return exitCodeFor(outcome);
  } catch (error) {
    await reportCrash(jira, issue, branch, error);
    throw error;
  } finally {
    await opened?.close();
  }
}

async function refuseOnBranchCollision(repoRoot: string, branch: string): Promise<void> {
  if (await branchExists(repoRoot, branch)) {
    throw new SandboxError(
      `Branch ${branch} already exists. relay never reuses or deletes a branch — ` +
        "review it and remove it yourself, then run again.",
    );
  }
}

/**
 * Best-effort: a crashed pass is still worth a note on the item, but a Jira
 * that will not take the comment must not replace the original failure.
 */
async function reportCrash(
  jira: JiraClient,
  issue: JiraIssue,
  branch: string,
  error: unknown,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    await jira.addComment(
      issue.key,
      `relay crashed during its pass on ${branch}: ${reason}\n\n` +
        "The item is left In Progress and the sandbox was disposed of.",
    );
  } catch (commentError) {
    console.error(`relay: could not comment the crash on ${issue.key}:`, commentError);
  }
}
