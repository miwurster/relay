import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigError, GitError } from "../errors.js";

/** Runs the `git` CLI and returns its trimmed stdout. Injectable for tests. */
export type GitRunner = (args: readonly string[]) => Promise<string>;

const execFileAsync = promisify(execFile);

/** The real `git` CLI. Every failure surfaces as a `GitError`. */
export const runGit: GitRunner = async (args) => {
  try {
    const { stdout } = await execFileAsync("git", [...args], { maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new GitError(`git ${args.join(" ")} failed: ${reason}`);
  }
};

/** github.com over ssh or https — the one remote shape init accepts. */
const GITHUB_REMOTE = /^(https:\/\/github\.com\/|git@github\.com:)/;

/** Whether a remote URL points at github.com. */
export function isGitHubRemote(url: string): boolean {
  return GITHUB_REMOTE.test(url);
}

/** Whether `repoRoot` is inside a git working tree. */
export async function isGitRepo({
  repoRoot,
  git = runGit,
}: {
  repoRoot: string;
  git?: GitRunner;
}): Promise<boolean> {
  try {
    await git(["-C", repoRoot, "rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

/** This clone's `origin` remote URL, or `undefined` when there is none. */
export async function originUrl({
  repoRoot,
  git = runGit,
}: {
  repoRoot: string;
  git?: GitRunner;
}): Promise<string | undefined> {
  try {
    const url = await git(["-C", repoRoot, "remote", "get-url", "origin"]);
    return url || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The branch the host has checked out — the one branch a pass is cut from,
 * reviewed against and reported against ([ADR-0016](../../docs/adr/0016-the-base-branch-is-the-hosts-checkout.md)).
 *
 * A detached or unborn HEAD is refused rather than fallen back on: there is no
 * branch to cut from, and a fallback would target a branch the operator is not
 * standing on.
 */
export async function currentBranch({
  repoRoot,
  git = runGit,
}: {
  repoRoot: string;
  git?: GitRunner;
}): Promise<string> {
  let branch: string;
  try {
    branch = await git(["-C", repoRoot, "symbolic-ref", "--short", "HEAD"]);
  } catch {
    throw new ConfigError(
      "Could not read a branch from this repo's HEAD — it is detached, or this is not a " +
        "git clone. A pass is cut from the branch you have checked out, so check out the " +
        "branch you want it to target, then run again.",
    );
  }

  try {
    await git(["-C", repoRoot, "rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    throw new ConfigError(
      `This repo's current branch ${branch} has no commits yet, so a pass has nothing ` +
        "to be cut from — commit something, then run again.",
    );
  }

  return branch;
}
