import { type Crew, NO_LANDING } from "./contract.js";
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
    implement: createImplementer({ ...deps, baseBranch }),
    review: createReviewer({ ...deps, baseBranch }),
    fix: createFixer(deps),
    greenGate: createGreenGate(deps),
    // The one place the declared landing decides anything: a `pull-request`
    // repo's pass pays nothing for a mode it did not choose, and every later
    // step reads the landing off what the lander reported.
    land:
      deps.config.landing === "merge"
        ? createLander({ ...deps, repoRoot, branch, baseBranch, git })
        : landsNothing,
    handover: createHandover({ ...deps, workItem, branch, baseBranch }),
  };
}

/**
 * The lander of a `pull-request` repo: no pass of one moves a branch, so it
 * opens no session, runs no gate and reports that nothing landed.
 */
const landsNothing: Crew["land"] = () => Promise.resolve(NO_LANDING);
