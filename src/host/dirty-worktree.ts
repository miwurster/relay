import { isWorktreeDirty, runGit, type GitRunner } from "./git.js";

/**
 * Why a pass landing on `baseBranch` itself would refuse this host's worktree,
 * or nothing when the worktree is clean.
 *
 * Only `merge` landing lands on the base branch, so only `merge` landing asks —
 * the caller decides that, because it already knows the landing and would
 * otherwise be told an answer it could not use.
 *
 * `merge` landing moves the operator's own branch, and relay never stashes work
 * it did not author ([ADR-0017](../../docs/adr/0017-the-lander-rebases-and-the-host-only-fast-forwards.md)).
 *
 * One sentence, worded once, that doctor grades a warning and a pass throws as a
 * config refusal ([ADR-0023](../../docs/adr/0023-doctor-and-a-pass-share-rules-not-a-module.md)).
 * Severity stays with the caller, so the answer is a reason and not a check or
 * an error.
 */
export async function whyDirtyWorktreeRefusesLanding({
  repoRoot,
  baseBranch,
  git = runGit,
}: {
  repoRoot: string;
  baseBranch: string;
  git?: GitRunner;
}): Promise<string | undefined> {
  if (!(await isWorktreeDirty({ repoRoot, git }))) return undefined;

  return (
    `This repo lands on ${baseBranch} itself, and your worktree has uncommitted work in it. ` +
    "relay never stashes work it did not author — commit or stash it yourself before a pass runs."
  );
}
