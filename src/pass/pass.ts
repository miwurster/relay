import type { Sandbox } from "@ai-hero/sandcastle";
import { loadConfig, type RelayConfig } from "../config.js";
import type { Crew } from "../crew/contract.js";
import { createCrew as createRelayCrew } from "../crew/crew.js";
import { ConfigError, SandboxError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import { passRecordDir } from "../crew/leg-record.js";
import { createGitHubClient, type GitHubClient, type GitHubIssue } from "../tracker/github.js";
import { exitCodeFor, runHarness } from "./harness.js";
import { openSandbox, passBranch, worktreeForBranch } from "../sandbox/sandbox.js";
import { branchExists, currentBranch, runGit, type GitRunner } from "../host/git.js";
import { whyDirtyWorktreeRefusesLanding } from "../host/dirty-worktree.js";
import { loadSecrets, type Secrets } from "../host/secrets.js";
import { requireTrackerDoc } from "../tracker/tracker-doc.js";
import { parseWorkItem, selectWorkItem } from "./work-item.js";

/** The one work item's pass, and the seams tests replace. */
export interface PassRun {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  issue: GitHubIssue;
  github: GitHubClient;
  open?: typeof openSandbox;
  createCrew?: (sandbox: Sandbox, branch: string, baseBranch: string) => Crew;
  git?: GitRunner;
}

/**
 * Run one pass over a single work item, then hand off to a human.
 *
 * The pass fails fast on an invalid config, an unresolvable secret or a missing
 * tracker doc before any sandbox work starts; deeper tool, auth and docker
 * failures surface lazily where they are first used.
 */
export async function runPass(workItem: string | undefined): Promise<ExitCode> {
  const repoRoot = process.cwd();
  const config = await loadConfig(repoRoot);
  const secrets = await loadSecrets({ repoRoot });
  await requireTrackerDoc(repoRoot);

  const github = createGitHubClient();
  const selection = await selectWorkItem(
    github,
    workItem === undefined ? undefined : parseWorkItem(workItem),
  );
  if (selection.kind === "nothing-to-do") {
    console.log("relay: nothing to do — no eligible ready-for-agent issue in this repo");
    return ExitCode.Success;
  }

  return await runPassOnItem({ repoRoot, config, secrets, issue: selection.issue, github });
}

/**
 * Resolve the pass's base branch, open the sandbox, run the crew in it, and
 * dispose of the sandbox whatever happens.
 *
 * The base branch is read from the host's checkout once, before any sandbox
 * work starts, and that one value feeds the branch cut, the reviewer's
 * whole-branch scope and the handover's commit range
 * ([ADR-0016](../../docs/adr/0016-the-base-branch-is-the-hosts-checkout.md)).
 *
 * A crash is reported on the item on the way out and then rethrown, so the
 * caller maps it to the error exit code. relay never unlabels the item — a
 * crash it cannot catch would leave the label behind anyway — so the item stays
 * held and a re-run is refused until a human lifts the hold. The comment says
 * how.
 */
export async function runPassOnItem({
  repoRoot,
  config,
  secrets,
  issue,
  github,
  open = openSandbox,
  createCrew = (opened, branch, baseBranch) =>
    createRelayCrew({
      sandbox: opened,
      config,
      recordDir: passRecordDir(repoRoot, issue.number),
      repoRoot,
      workItem: issue.number,
      branch,
      baseBranch,
      git,
    }),
  git = runGit,
}: PassRun): Promise<ExitCode> {
  const branch = passBranch(config, issue.number);
  const baseBranch = await currentBranch({ repoRoot, git });
  // Before the sandbox is built, so a refusal costs nothing. Only `merge`
  // landing moves the host's branch, so only `merge` landing cares; the rule
  // and its one sentence live on the host layer, where doctor reads the same
  // sentence as a warning.
  if (config.landing === "merge") {
    const reason = await whyDirtyWorktreeRefusesLanding({ repoRoot, baseBranch, git });
    if (reason) throw new ConfigError(reason);
  }
  await refuseOnBranchCollision({ repoRoot, branch, git });

  let opened: Sandbox | undefined;
  try {
    // Inside the try: a sandbox that will not open is the likeliest crash of
    // all, and it deserves the same note on the item as one that dies later.
    opened = await open({ repoRoot, config, secrets, branch, baseBranch });
    const outcome = await runHarness(createCrew(opened, branch, baseBranch), issue);
    return exitCodeFor(outcome);
  } catch (error) {
    await reportCrash(github, issue, branch, error);
    throw error;
  } finally {
    await opened?.close();
  }
}

/**
 * Refuse a branch a pass did not cut itself. relay never reuses, resets or
 * deletes one: an existing branch may carry someone else's commits, and losing
 * those is worse than refusing to run.
 */
async function refuseOnBranchCollision({
  repoRoot,
  branch,
  git,
}: {
  repoRoot: string;
  branch: string;
  git: GitRunner;
}): Promise<void> {
  if (!(await branchExists({ repoRoot, branch, git }))) return;

  throw new SandboxError(
    `Branch ${branch} already exists. relay never reuses or deletes a branch — ` +
      (await cleanupAdvice(repoRoot, branch)),
  );
}

/**
 * A crashed pass leaves its worktree behind, and git refuses to delete a
 * branch still checked out in one — so telling the human to remove the branch
 * without naming the worktree sends them somewhere they cannot go.
 */
async function cleanupAdvice(repoRoot: string, branch: string): Promise<string> {
  const worktree = await worktreeForBranch(repoRoot, branch);
  if (!worktree) return "review it and remove it yourself, then run again.";

  return (
    `a crashed pass left it checked out at ${worktree}. Remove that worktree first ` +
    `(\`git worktree remove --force ${worktree}\`), then the branch, then run again.`
  );
}

/**
 * Best-effort: a crashed pass is still worth a note on the item, but a GitHub
 * that will not take the comment must not replace the original failure.
 */
async function reportCrash(
  github: GitHubClient,
  issue: GitHubIssue,
  branch: string,
  error: unknown,
): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error);
  try {
    await github.addComment(
      issue.number,
      `relay crashed during its pass on ${branch}: ${reason}\n\n` +
        "The sandbox was disposed of, and this item is left labelled `agent-in-progress`, " +
        "which no further pass will run over. To hand it back to relay, review " +
        `\`${branch}\` and delete it, then remove the label:\n\n` +
        "```sh\n" +
        `git branch -D ${branch}\n` +
        `gh issue edit ${issue.number} --remove-label agent-in-progress\n` +
        "```",
    );
  } catch (commentError) {
    console.error(`relay: could not comment the crash on #${issue.number}:`, commentError);
  }
}
