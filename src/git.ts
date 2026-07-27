import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { GitError } from "./errors.js";

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
 * The clone's default branch, read from `origin/HEAD`. A fresh clone that
 * never set it (or a repo with no remote-tracking branch at all) falls back
 * to the current branch rather than failing.
 */
export async function defaultBranch({
  repoRoot,
  git = runGit,
}: {
  repoRoot: string;
  git?: GitRunner;
}): Promise<string> {
  try {
    const ref = await git(["-C", repoRoot, "symbolic-ref", "refs/remotes/origin/HEAD"]);
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch {
    // origin/HEAD unset — fall back to the current branch.
  }
  return git(["-C", repoRoot, "rev-parse", "--abbrev-ref", "HEAD"]);
}
