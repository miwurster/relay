import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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

/** Whether these `.gitignore` contents already ignore the worktree directory. */
export function ignoresWorktreeDir(gitignore: string): boolean {
  return gitignore
    .split("\n")
    .some((line) => line.trim().replace(/^\/+|\/+$/g, "") === WORKTREE_DIR);
}

/**
 * The same contents with the worktree directory ignored. Appended, never
 * rewritten: a `.gitignore` is the repo's file, not relay's.
 */
export function withWorktreeDirIgnored(gitignore: string): string {
  const entry = `# A relay pass's git worktree.\n${WORKTREE_DIR}/\n`;
  if (gitignore === "") return entry;
  return `${gitignore}${gitignore.endsWith("\n") ? "\n" : "\n\n"}${entry}`;
}
