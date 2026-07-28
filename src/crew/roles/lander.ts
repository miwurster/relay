import { z } from "zod";
import type { Crew, GateResult, LandResult } from "../contract.js";
import { reasonOf } from "../../errors.js";
import { fastForwardTo, pushBranch, runGit, type GitRunner } from "../../host/git.js";
import { type RoleDeps, runRole } from "../run-role.js";

/** The block the lander ends its run with, and the prompt it runs from. */
export const LAND_TAG = "relay-land";
const LANDER_PROMPT = "lander.md";

/**
 * How the leg got the base branch's commits into the pass branch: a clean
 * rebase, the single merge a conflict falls back to, or neither.
 */
const landSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rebased") }),
  z.object({ kind: z.literal("merged") }),
  z.object({ kind: z.literal("stuck"), reason: z.string().min(1) }),
]);

/**
 * The lander: get the pass branch onto the base branch, under `merge` landing.
 *
 * Two halves, in one crew member because they are one decision. In the sandbox,
 * a cold agent session rebases the pass branch onto the base branch — or, on
 * conflict, merges the base branch in and resolves once
 * ([ADR-0017](../../../docs/adr/0017-the-lander-rebases-and-the-host-only-fast-forwards.md)).
 * On the host, once the harness's re-run of the gate is green, `git`
 * fast-forwards the base branch onto that result and pushes it.
 *
 * Because the leg only ever moves the pass branch, the base branch is an
 * ancestor of what lands and the host's step cannot conflict. A refusal is
 * reported rather than forced: the operator's branch is theirs.
 */
export function createLander({
  repoRoot,
  branch,
  baseBranch,
  git = runGit,
  ...deps
}: RoleDeps & {
  /** The host clone, whose checkout is the base branch this lands on. */
  repoRoot: string;
  branch: string;
  baseBranch: string;
  git?: GitRunner;
}): NonNullable<Crew["land"]> {
  return async function land(regate: () => Promise<GateResult>): Promise<LandResult> {
    const integrated = await runRole({
      ...deps,
      name: "lander",
      model: deps.config.models.lander,
      prompt: LANDER_PROMPT,
      promptArgs: { BRANCH: branch, BASE_BRANCH: baseBranch },
      tag: LAND_TAG,
      schema: landSchema,
      // A rebase rewrites commits and the conflict path authors a merge commit,
      // so there is no commit shape to hold the leg to.
      branchRule: () => "any",
    });
    if (integrated.kind === "stuck") {
      return { kind: "not-landed", reason: integrated.reason };
    }

    const gate = await regate();
    if (!gate.green) {
      return {
        kind: "not-landed",
        reason: `${branch} is red once ${baseBranch} is in it: ${gate.detail}`,
      };
    }

    return await moveBaseBranch({ how: integrated.kind, repoRoot, branch, baseBranch, git });
  };
}

/**
 * The host-side move: fast-forward the base branch onto the pass branch, then
 * push it — in that order, so nothing is ever closed over work that only exists
 * on the operator's machine.
 */
async function moveBaseBranch({
  how,
  repoRoot,
  branch,
  baseBranch,
  git,
}: {
  how: "rebased" | "merged";
  repoRoot: string;
  branch: string;
  baseBranch: string;
  git: GitRunner;
}): Promise<LandResult> {
  try {
    await fastForwardTo({ repoRoot, branch, git });
  } catch (error) {
    return {
      kind: "not-landed",
      reason:
        `${baseBranch} would not fast-forward onto ${branch}, and relay never forces one — ` +
        `review the branch yourself: ${reasonOf(error)}`,
    };
  }

  try {
    await pushBranch({ repoRoot, branch: baseBranch, git });
  } catch (error) {
    return {
      kind: "not-landed",
      reason:
        `${baseBranch} was fast-forwarded onto ${branch} but the push was rejected, so the ` +
        `work is on this machine only and nothing was closed: ${reasonOf(error)}`,
    };
  }

  return {
    kind: "landed",
    detail: `${branch} was ${how} onto ${baseBranch}, which fast-forwarded onto it and was pushed.`,
  };
}
