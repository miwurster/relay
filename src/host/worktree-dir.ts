import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { carriesEntry, withEntry } from "./gitignore.js";

/**
 * Where a pass's git worktree is cut: `<repo>/.sandcastle/worktrees/<branch>`,
 * inside the repo the pass runs on. The location is sandcastle's and is not
 * configurable, so a repo relay runs on has to ignore it or every pass shows
 * up in `git status` as untracked noise.
 */
export const WORKTREE_DIR = ".sandcastle";

export const GITIGNORE_FILE_NAME = ".gitignore";

/** The repo's `.gitignore`, or empty when it has none. */
export async function readGitignore(repoRoot: string): Promise<string> {
  const path = join(repoRoot, GITIGNORE_FILE_NAME);
  return existsSync(path) ? readFile(path, "utf8") : "";
}

/** The worktree directory's entry, as it reads in the repo's own `.gitignore`. */
const WORKTREE_ENTRY = { entry: `${WORKTREE_DIR}/`, why: "A relay pass's git worktree." };

/** Whether these `.gitignore` contents already ignore the worktree directory. */
export function ignoresWorktreeDir(gitignore: string): boolean {
  return carriesEntry(gitignore, WORKTREE_ENTRY.entry);
}

/**
 * The same contents with the worktree directory ignored — appended, since a
 * root `.gitignore` is the repo's file and not relay's.
 */
export function withWorktreeDirIgnored(gitignore: string): string {
  return withEntry(gitignore, WORKTREE_ENTRY);
}
