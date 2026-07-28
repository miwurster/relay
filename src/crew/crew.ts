import type { Crew } from "./contract.js";
import { runGit, type GitRunner } from "../host/git.js";
import { createFixer } from "./roles/fixer.js";
import { createGateResolver } from "./roles/gate-resolver.js";
import { createGreenGate } from "./roles/green-gate.js";
import { createHandover } from "./roles/handover.js";
import { createImplementer } from "./roles/implementer.js";
import { createLander } from "./roles/lander.js";
import { createPlanner } from "./roles/planner.js";
import { createReviewer } from "./roles/reviewer.js";
import type { RoleDeps } from "./run-role.js";

/**
 * The crew a real pass runs: every role in the pass's own sandbox, from the
 * plan to the handover that gives the human the baton.
 */
export function createCrew({
  repoRoot,
  workItem,
  branch,
  baseBranch,
  git = runGit,
  ...deps
}: RoleDeps & {
  /** The host clone, whose checkout the lander fast-forwards. */
  repoRoot: string;
  /** The issue number of the work item this pass runs over. */
  workItem: number;
  /** The branch the pass commits to, and the handover publishes. */
  branch: string;
  /** The branch the pass was cut from, reviewed against and reported against. */
  baseBranch: string;
  /** The host's `git`, which only the lander uses. */
  git?: GitRunner;
}): Crew {
  return {
    resolveGate: createGateResolver(deps),
    plan: createPlanner(deps),
    implement: createImplementer(deps),
    review: createReviewer({ ...deps, baseBranch }),
    fix: createFixer(deps),
    greenGate: createGreenGate(deps),
    // A lander only under `merge` landing: a `pull-request` repo's pass pays
    // nothing for a mode it did not choose, and the crew's size says which
    // landing the repo declared.
    ...(deps.config.landing === "merge"
      ? { land: createLander({ ...deps, repoRoot, branch, baseBranch, git }) }
      : {}),
    handover: createHandover({ ...deps, workItem, branch, baseBranch }),
  };
}
