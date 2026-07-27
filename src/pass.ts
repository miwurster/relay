import type { Sandbox } from "@ai-hero/sandcastle";
import { loadConfig, type RelayConfig } from "./config.js";
import { createCrew as createRelayCrew, type Crew } from "./crew.js";
import { SandboxError } from "./errors.js";
import { ExitCode } from "./exit-codes.js";
import { passOutputDir } from "./findings-file.js";
import { createGitHubClient, type GitHubClient, type GitHubIssue } from "./github.js";
import { exitCodeFor, runHarness } from "./harness.js";
import { branchExists, openSandbox, passBranch } from "./sandbox.js";
import { loadSecrets, type Secrets } from "./secrets.js";
import { requireTrackerDoc } from "./tracker-doc.js";
import { parseWorkItem, selectWorkItem } from "./work-item.js";

/** The one work item's pass, and the two seams tests replace. */
export interface PassRun {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  issue: GitHubIssue;
  github: GitHubClient;
  open?: typeof openSandbox;
  createCrew?: (sandbox: Sandbox, branch: string) => Crew;
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
  const secrets = await loadSecrets();
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
 * Open the sandbox, run the crew in it, and dispose of it whatever happens.
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
  createCrew = (opened, branch) =>
    createRelayCrew({
      sandbox: opened,
      config,
      outputDir: passOutputDir(repoRoot, issue.number),
      workItem: issue.number,
      branch,
    }),
}: PassRun): Promise<ExitCode> {
  const branch = passBranch(config, issue.number);
  await refuseOnBranchCollision(repoRoot, branch);

  let opened: Sandbox | undefined;
  try {
    // Inside the try: a sandbox that will not open is the likeliest crash of
    // all, and it deserves the same note on the item as one that dies later.
    opened = await open({ repoRoot, config, secrets, branch });
    const outcome = await runHarness(createCrew(opened, branch), issue);
    return exitCodeFor(outcome);
  } catch (error) {
    await reportCrash(github, issue, branch, error);
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
