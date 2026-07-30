import type { Landing } from "../config.js";
import { isWorktreeDirty, runGit, type GitRunner } from "./git.js";

/**
 * Why a pass would refuse this host's worktree, or nothing when there is
 * nothing to refuse over — the repo lands through a pull request, or the
 * worktree is clean.
 *
 * `merge` landing moves the operator's own branch, and relay never stashes work
 * it did not author ([ADR-0017](../../docs/adr/0017-the-lander-rebases-and-the-host-only-fast-forwards.md)).
 *
 * One sentence, worded once, that doctor grades a warning and a pass throws as a
 * config refusal ([ADR-0023](../../docs/adr/0023-doctor-and-a-pass-share-rules-not-a-module.md)).
 * Severity stays with the caller, so the answer is a reason and not a check or
 * an error.
 */
export async function whyLandingRefusesWorktree({
  repoRoot,
  landing,
  baseBranch,
  git = runGit,
}: {
  repoRoot: string;
  landing: Landing;
  baseBranch: string;
  git?: GitRunner;
}): Promise<string | undefined> {
  if (landing !== "merge") return undefined;
  if (!(await isWorktreeDirty({ repoRoot, git }))) return undefined;

  return (
    `This repo lands on ${baseBranch} itself, and your worktree has uncommitted work in it. ` +
    "relay never stashes work it did not author — commit or stash it yourself before a pass runs."
  );
}
