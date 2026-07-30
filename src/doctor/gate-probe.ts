import type { Sandbox } from "@ai-hero/sandcastle";
import type { RelayConfig } from "../config.js";
import type { ResolvedGate } from "../crew/contract.js";
import { createGateResolver } from "../crew/roles/gate-resolver.js";
import { branchExists, type GitRunner, runGit } from "../host/git.js";
import { doctorRecordDir } from "../crew/leg-record.js";
import { openSandbox } from "../sandbox/sandbox.js";
import type { Secrets } from "../host/secrets.js";

/**
 * Resolves the gate a pass would verify with, without being a pass. Injectable
 * so no doctor test opens a sandbox or spends a session.
 *
 * The base branch and the image come in rather than being resolved here:
 * doctor resolves this host's checkout and proves this repo's image once per
 * run, and a `HEAD` no pass could run on — or an image that had to be built —
 * is one problem, not one per check that needed it.
 */
export type GateProbe = (input: {
  repoRoot: string;
  config: RelayConfig;
  secrets: Secrets;
  baseBranch: string;
  image: string;
}) => Promise<ResolvedGate>;

/**
 * The branch the probe runs its one leg on. Named rather than numbered, so it
 * can never be the branch of a pass — those are the prefix and an issue number.
 */
function probeBranch(config: RelayConfig): string {
  return `${config.branchPrefix}doctor`;
}

/**
 * The real probe: open a sandbox, run the gate resolver in it, and take the
 * sandbox and its branch back down.
 *
 * The resolver is the pass's own first leg, so what doctor reports is what a
 * pass would resolve — not a second implementation of the same reading.
 */
export async function probeGate({
  repoRoot,
  config,
  secrets,
  baseBranch,
  image,
  open = openSandbox,
  git = runGit,
}: Parameters<GateProbe>[0] & {
  open?: typeof openSandbox;
  git?: GitRunner;
}): Promise<ResolvedGate> {
  const branch = probeBranch(config);
  let sandbox: Sandbox | undefined;
  try {
    sandbox = await open({ repoRoot, config, secrets, branch, baseBranch, image });
    return await createGateResolver({
      sandbox,
      config,
      recordDir: doctorRecordDir(repoRoot),
    })();
  } finally {
    await dispose({ sandbox, repoRoot, branch, git });
  }
}

/**
 * Take the probe's sandbox and branch down, whatever the leg did.
 *
 * relay never deletes a branch, because a branch may carry commits worth a
 * human's time. This one cannot: the probe's single leg is forbidden from
 * committing, so the only real hazard is leaving it behind for the next doctor
 * run to collide with — which is why the delete runs even when the close threw,
 * and even when the sandbox never opened at all: an open that failed half way
 * may still have cut the branch.
 *
 * Neither step may replace the failure that brought us here, so a cleanup that
 * cannot finish is reported and swallowed.
 */
async function dispose({
  sandbox,
  repoRoot,
  branch,
  git,
}: {
  sandbox: Sandbox | undefined;
  repoRoot: string;
  branch: string;
  git: GitRunner;
}): Promise<void> {
  try {
    await sandbox?.close();
  } catch (error) {
    console.error("relay doctor: could not dispose of the gate probe's sandbox:", error);
  }

  await deleteBranch({ repoRoot, branch, git });
}

/**
 * Delete the probe's branch, if it got as far as existing. The human who would
 * have to remove a stubborn one by hand is told which branch it is.
 */
async function deleteBranch({
  repoRoot,
  branch,
  git,
}: {
  repoRoot: string;
  branch: string;
  git: GitRunner;
}): Promise<void> {
  if (!(await branchExists({ repoRoot, branch, git }))) return;

  try {
    await git(["-C", repoRoot, "branch", "-D", branch]);
  } catch (error) {
    console.error(`relay doctor: could not delete the gate probe's branch ${branch}:`, error);
  }
}
