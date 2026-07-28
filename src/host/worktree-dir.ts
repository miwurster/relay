import type { IgnoreRule } from "./gitignore.js";

/**
 * Where a pass's git worktree is cut: `<repo>/.sandcastle/worktrees/<branch>`,
 * inside the repo the pass runs on. The location is sandcastle's and is not
 * configurable, so a repo relay runs on has to ignore it or every pass shows
 * up in `git status` as untracked noise.
 */
export const WORKTREE_DIR = ".sandcastle";

export const GITIGNORE_FILE_NAME = ".gitignore";

/**
 * The worktree directory belongs in the repo's own `.gitignore`, since that is
 * the file git reads for a path in the repo root.
 */
export const WORKTREE_RULE: IgnoreRule = {
  file: GITIGNORE_FILE_NAME,
  entries: [`${WORKTREE_DIR}/`],
  why: "A relay pass's git worktree.",
};
