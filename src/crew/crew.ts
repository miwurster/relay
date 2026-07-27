import type { Crew } from "./contract.js";
import { createFixer } from "./roles/fixer.js";
import { createGateResolver } from "./roles/gate-resolver.js";
import { createGreenGate } from "./roles/green-gate.js";
import { createHandover } from "./roles/handover.js";
import { createImplementer } from "./roles/implementer.js";
import { createPlanner } from "./roles/planner.js";
import { createReviewer } from "./roles/reviewer.js";
import type { RoleDeps } from "./run-role.js";

/**
 * The crew a real pass runs: every role in the pass's own sandbox, from the
 * plan to the handover that gives the human the baton.
 */
export function createCrew({
  workItem,
  branch,
  ...deps
}: RoleDeps & {
  /** The issue number of the work item this pass runs over. */
  workItem: number;
  /** The branch the pass commits to, and the handover publishes. */
  branch: string;
}): Crew {
  return {
    resolveGate: createGateResolver(deps),
    plan: createPlanner(deps),
    implement: createImplementer(deps),
    review: createReviewer(deps),
    fix: createFixer(deps),
    greenGate: createGreenGate(deps),
    handover: createHandover({ ...deps, workItem, branch }),
  };
}
